"""Fraud-Research Agent — A2A server handler.

Exposes a Strands agent as an Agent-to-Agent (A2A) server, deployed as its own
AgentCore Runtime configured with ``protocolConfiguration: "A2A"``. Per the
AgentCore A2A contract, ``serve_a2a`` runs a stateless, streamable HTTP server
on ``0.0.0.0:9000`` at root path ``/``, serves the agent card at
``/.well-known/agent-card.json``, exposes ``/ping``, sets ``AGENTCORE_RUNTIME_URL``,
and propagates Bedrock headers. JSON-RPC 2.0 ``message/send`` payloads from
``InvokeAgentRuntime`` are passed through unmodified.

On each inbound request the :class:`FraudResearchExecutor` gates the assessment:

1. reads ``message.metadata.identity_context`` (:func:`read_identity_context`) and
   verifies the forwarded customer JWT (:func:`verify_user_pool_jwt`), rejecting
   an absent/invalid/expired assertion with a JSON-RPC authorization error so the
   assessment never runs (Req 5.4, 6.3 — Property 7);
2. rejects any requested skill/method other than the single advertised
   ``fraud_research_assessment`` capability (Req 6.4 — Property 8);
3. blocks the invocation when the Bedrock guardrail cannot be applied, so a
   model call never runs ungoverned (Req 7.5 — Property 10);
4. binds the verified customer ``sub`` into a :class:`UserScopeHook` so Gateway
   tool calls carry the propagated identity (Req 5.3, 7.1 — Property 6);
5. authenticates the Gateway MCP client with the fraud agent's **own** M2M
   client so it reaches the Gateway as a distinct principal (Req 7.4 —
   Property 9);
6. tags spans with the customer ``sub`` and the acting-agent id
   ``fraud_research`` (Req 5.5, 8.4 — Property 6);
7. returns a schema-valid assessment artifact (Req 1.3 — Property 11).

The gating decisions are factored into small, dependency-injected seam functions
(:func:`verify_request_identity`, :func:`validate_requested_skill`,
:func:`ensure_guardrail_config`, :func:`build_assessment_artifact`) so they can be
exercised with the model and Gateway MCP client mocked, no deploy required.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    InternalError,
    InvalidRequestError,
    UnsupportedOperationError,
)
from a2a.utils.errors import ServerError
from agent_card import (
    ADVERTISED_SKILLS,
    AGENT_DESCRIPTION,
    AGENT_NAME,
    AGENT_VERSION,
    DEFAULT_INPUT_MODES,
    DEFAULT_OUTPUT_MODES,
    FRAUD_RESEARCH_SKILL_ID,
    PREFERRED_TRANSPORT,
    build_agent_skills,
)
from bedrock_agentcore.runtime import serve_a2a
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.multiagent.a2a.executor import StrandsA2AExecutor
from strands.tools.mcp import MCPClient
from utils.auth import (
    IdentityVerificationError,
    get_agent_access_token,
    verify_user_pool_jwt,
)
from utils.identity_context import read_identity_context
from utils.ssm import get_ssm_parameter
from utils.tool_guard import UserScopeHook

logger = logging.getLogger(__name__)

# AgentCore's A2A proxy requires the container to serve on port 9000 at "/".
A2A_PORT = 9000

# Default model id; overridden per-deployment via the MODEL_ID env var.
DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-6"

# Acting-agent id this callee tags its spans/artifacts with (Req 5.5, 8.4).
ACTING_AGENT_ID = "fraud_research"

# The closed set of assessment verdicts the artifact may carry (Req 1.3).
VALID_ASSESSMENTS: tuple[str, ...] = ("clear", "review", "flagged")

# Risk score bounds; the model output is coerced into this integer range.
_MIN_RISK_SCORE = 0
_MAX_RISK_SCORE = 100
_DEFAULT_RISK_SCORE = 50

# Message-metadata keys a caller may use to name a requested capability. Any
# value other than the single advertised skill is rejected (Req 6.4).
_REQUESTED_SKILL_KEYS: tuple[str, ...] = ("skill", "skill_id")

# Placeholder invocation URL advertised until the platform sets
# AGENTCORE_RUNTIME_URL (which serve_a2a folds into the served card).
DEFAULT_ADVERTISED_URL = f"http://localhost:{A2A_PORT}/"


# ─── Typed rejections (per-request gating) ────────────────────────────────────


class FraudRequestRejected(Exception):
    """An inbound A2A request is rejected before the assessment runs.

    Raised by the gating seams for an unverified customer identity
    (``reason="identity"``) or an unauthorized capability
    (``reason="capability"``). The executor maps it to the matching JSON-RPC
    error so the assessment never runs (Req 5.4, 6.4).
    """

    def __init__(self, detail: str, *, reason: str) -> None:
        self.detail = detail
        self.reason = reason
        super().__init__(detail)


class GuardrailUnavailableError(Exception):
    """The Bedrock guardrail cannot be applied, so the model call is blocked.

    Unlike the researcher agent — which silently continues without a guardrail —
    the fraud agent must never issue an ungoverned model call. When the guardrail
    config cannot be loaded, this is raised and the invocation is blocked
    (Req 7.5 — Property 10).
    """


# ─── Configuration / dependency builders ──────────────────────────────────────


def _load_system_prompt() -> str:
    """Read the fraud/research analyst persona prompt shipped with the package."""
    prompt_path = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
    with open(prompt_path, encoding="utf-8") as prompt_file:
        return prompt_file.read()


def create_gateway_mcp_client(access_token: str) -> MCPClient:
    """Create an MCP client for the AgentCore Gateway with OAuth2 auth.

    Mirrors the researcher agent's client construction: the Gateway URL is read
    from SSM and the bearer authenticates the *fraud agent's own* principal.

    Args:
        access_token: Valid OAuth2 bearer token for the Gateway (minted from the
            fraud agent's own M2M client — see :func:`fraud_gateway_access_token`).

    Returns:
        MCPClient: Gateway MCP client exposing the research tools (kb_search /
        web_search / data_sources). Sensitive write/PII tools are denied to the
        fraud principal by Cedar at the Gateway, not filtered here.

    Raises:
        ValueError: If STACK_NAME is missing or malformed.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    logger.info("[FRAUD] Gateway URL from SSM: %s", gateway_url)

    return MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
    )


def fraud_gateway_access_token() -> str:
    """Mint the Gateway access token using the fraud agent's OWN M2M client.

    Reads the fraud client's SSM parameter / secret names from the environment
    (``FRAUD_AGENT_CLIENT_ID_PARAM`` / ``FRAUD_AGENT_CLIENT_SECRET_PARAM``),
    falling back to the stack's ``fraud_agent_client_*`` params. This is a
    *distinct* principal from the shared machine client used by
    ``utils.auth.get_gateway_access_token`` (Req 7.4 — Property 9), so Cedar can
    attribute the fraud agent's tool calls to its own client.

    Returns:
        str: A valid OAuth2 access token for the fraud agent's client.
    """
    stack_name = os.environ.get("STACK_NAME", "")
    client_id_param = os.environ.get("FRAUD_AGENT_CLIENT_ID_PARAM", f"/{stack_name}/fraud_agent_client_id")
    secret_param = os.environ.get("FRAUD_AGENT_CLIENT_SECRET_PARAM", f"/{stack_name}/fraud_agent_client_secret")
    return get_agent_access_token(client_id_param, secret_param)


def _load_guardrail_config() -> dict[str, str] | None:
    """Load the Bedrock guardrail config from SSM, or ``None`` if unavailable."""
    stack_name = os.environ.get("STACK_NAME", "")
    if not stack_name:
        return None
    try:
        guardrail_id = get_ssm_parameter(f"/{stack_name}/guardrail_id")
        guardrail_version = get_ssm_parameter(f"/{stack_name}/guardrail_version")
    except Exception as exc:  # noqa: BLE001 — any SSM failure means "no guardrail available"
        logger.warning("[FRAUD] Guardrail config not available: %s", exc)
        return None
    if guardrail_id and guardrail_version:
        return {"guardrailIdentifier": guardrail_id, "guardrailVersion": guardrail_version}
    return None


def ensure_guardrail_config(*, loader: Callable[[], dict[str, str] | None] = _load_guardrail_config) -> dict[str, str]:
    """Return the guardrail config, or raise so the model call is blocked.

    This is the seam that enforces Requirement 7.5 (Property 10): if the
    guardrail cannot be applied, the model call must not be issued.

    Args:
        loader: Injectable guardrail-config loader (tests supply a fake).

    Returns:
        The non-empty guardrail config dict.

    Raises:
        GuardrailUnavailableError: If no usable guardrail config is available.
    """
    guardrail_config = loader()
    if not guardrail_config:
        raise GuardrailUnavailableError(
            "Bedrock guardrail is not available; blocking the fraud-agent model call (Req 7.5)."
        )
    return guardrail_config


def _build_model(guardrail_config: dict[str, str], *, model_id: str | None = None) -> BedrockModel:
    """Build the Bedrock model with the guardrail always applied.

    The guardrail config is required — a fraud-agent model is never built
    without one (see :func:`ensure_guardrail_config`).

    Raises:
        GuardrailUnavailableError: If ``guardrail_config`` is empty.
    """
    if not guardrail_config:
        raise GuardrailUnavailableError("Refusing to build a fraud-agent model without a guardrail (Req 7.5).")
    resolved_model_id = model_id or os.environ.get("MODEL_ID", DEFAULT_MODEL_ID)
    return BedrockModel(model_id=resolved_model_id, temperature=0.1, guardrail_config=guardrail_config)


# ─── Per-request gating seams ─────────────────────────────────────────────────


def verify_request_identity(
    message: Any,
    *,
    verifier: Callable[[str], dict[str, Any]] = verify_user_pool_jwt,
) -> dict[str, Any]:
    """Verify the forwarded customer identity assertion on an inbound message.

    Reads ``message.metadata.identity_context`` and verifies it cryptographically.
    A missing/malformed/expired/bad-signature assertion is rejected so the
    assessment never runs (Req 5.4 — Property 7).

    Args:
        message: The inbound A2A message (dict- or object-shaped).
        verifier: Injectable JWT verifier (tests supply a local-key verifier).

    Returns:
        The verified JWT claims (guaranteed to contain a non-empty ``sub``).

    Raises:
        FraudRequestRejected: If the assertion is absent or fails verification.
    """
    assertion = read_identity_context(message)
    if not assertion or not assertion.strip():
        raise FraudRequestRejected("A2A request is missing a verified customer identity assertion", reason="identity")
    try:
        claims = verifier(assertion)
    except IdentityVerificationError as exc:
        raise FraudRequestRejected(f"Customer identity verification failed: {exc}", reason="identity") from exc

    if not claims.get("sub"):
        raise FraudRequestRejected("Verified customer identity is missing a subject", reason="identity")
    return claims


def read_requested_skill(message: Any) -> str | None:
    """Extract a caller-named capability from the message metadata, if any."""
    metadata = _get(message, "metadata")
    if metadata is None:
        return None
    for key in _REQUESTED_SKILL_KEYS:
        value = _get(metadata, key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def validate_requested_skill(requested_skill: str | None) -> None:
    """Reject any requested capability other than the single advertised skill.

    Advertising exactly one skill (``fraud_research_assessment``) is the
    mechanism by which unknown-capability requests are rejected (Req 6.4 —
    Property 8). A request that names no skill defaults to the single advertised
    capability and is allowed.

    Raises:
        FraudRequestRejected: If ``requested_skill`` is a non-empty value other
            than ``fraud_research_assessment``.
    """
    if requested_skill is None:
        return
    if requested_skill != FRAUD_RESEARCH_SKILL_ID:
        raise FraudRequestRejected(
            f"Unsupported skill/method {requested_skill!r}; this agent advertises only {FRAUD_RESEARCH_SKILL_ID!r}",
            reason="capability",
        )


# ─── Assessment artifact (schema guarantee) ───────────────────────────────────


def build_assessment_artifact(model_output: Any, *, customer_sub: str) -> dict[str, Any]:
    """Normalize raw model output into a schema-valid assessment artifact.

    This is the seam that guarantees Requirement 1.3 (Property 11): whatever the
    model returns, the artifact has ``assessment`` in ``{clear, review, flagged}``,
    an integer ``risk_score``, a ``signals`` list, a ``rationale`` string, and the
    propagated ``acting_customer_sub`` / ``acting_agent`` identity fields. The
    identity fields are always set from the verified ``customer_sub`` and the
    fixed acting-agent id — never trusted from model output.

    Args:
        model_output: The raw model result (str, dict, or a Strands result-like
            object exposing ``.message``).
        customer_sub: The verified customer subject to stamp on the artifact.

    Returns:
        A schema-valid assessment dict.
    """
    parsed = _coerce_to_dict(model_output)

    verdict = parsed.get("assessment")
    if isinstance(verdict, str) and verdict.strip().lower() in VALID_ASSESSMENTS:
        assessment = verdict.strip().lower()
    else:
        # Fail toward caution: an unparseable/invalid verdict becomes "review".
        assessment = "review"

    rationale = parsed.get("rationale")
    return {
        "assessment": assessment,
        "risk_score": _coerce_risk_score(parsed.get("risk_score")),
        "signals": _coerce_str_list(parsed.get("signals")),
        "rationale": rationale if isinstance(rationale, str) else "",
        "acting_customer_sub": customer_sub,
        "acting_agent": ACTING_AGENT_ID,
    }


# ─── Agent construction ───────────────────────────────────────────────────────


def create_fraud_research_agent(
    context_id: str | None = None,
    *,
    user_id: str,
    guardrail_config: dict[str, str],
    session_id: str | None = None,
    gateway_token_provider: Callable[[], str] = fraud_gateway_access_token,
    gateway_client_factory: Callable[[str], Any] = create_gateway_mcp_client,
    model_factory: Callable[[dict[str, str]], Any] = _build_model,
) -> Agent:
    """Construct the fraud-research Strands agent bound to one verified customer.

    Building a fresh agent per context/customer keeps concurrent callers isolated
    (Req 11.5 — Property 12): each agent carries its own :class:`UserScopeHook`,
    so no identity from one request can bleed into another. The Gateway MCP client
    is authenticated with the fraud agent's own M2M client (Req 7.4 — Property 9),
    the model always runs under a guardrail (Req 7.5), and the span attributes
    carry the customer ``sub`` and the acting-agent id (Req 5.5, 8.4 — Property 6).

    Args:
        context_id: The A2A conversation context id (used for span/session id
            when no explicit session id is supplied).
        user_id: The verified customer ``sub`` to force-inject into user-scoped
            Gateway tool calls.
        guardrail_config: The guardrail config to apply to the model (required).
        session_id: Optional session id for span/trace attribution.
        gateway_token_provider: Injectable Gateway-token minter (tests fake it).
        gateway_client_factory: Injectable Gateway MCP client builder.
        model_factory: Injectable model builder (tests fake it).

    Returns:
        Agent: The configured fraud-research agent with research tools, the
        verified-identity hook, and the guardrailed model.
    """
    access_token = gateway_token_provider()
    gateway_client = gateway_client_factory(access_token)
    model = model_factory(guardrail_config)

    return Agent(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        system_prompt=_load_system_prompt(),
        model=model,
        tools=[gateway_client],
        hooks=[UserScopeHook(user_id)],
        callback_handler=None,
        trace_attributes={
            "user.id": user_id,
            "session.id": session_id or context_id or "",
            "agent.role": ACTING_AGENT_ID,
            "acting_agent": ACTING_AGENT_ID,
        },
    )


# ─── A2A executor ─────────────────────────────────────────────────────────────


class FraudResearchExecutor(StrandsA2AExecutor):
    """A2A executor that gates every request before running the assessment.

    Subclasses :class:`StrandsA2AExecutor` (per-context concurrency + isolation)
    and overrides :meth:`execute` to enforce the callee-side security checks —
    identity verification, capability validation, and guardrail availability —
    before delegating the streamed assessment to the base executor. The verified
    customer ``sub`` for each request is bound so the per-context agent factory
    builds an agent scoped to exactly that customer.
    """

    def __init__(
        self,
        *,
        verifier: Callable[[str], dict[str, Any]] = verify_user_pool_jwt,
        guardrail_loader: Callable[[], dict[str, str] | None] = _load_guardrail_config,
        gateway_token_provider: Callable[[], str] = fraud_gateway_access_token,
        gateway_client_factory: Callable[[str], Any] = create_gateway_mcp_client,
        model_factory: Callable[[dict[str, str]], Any] = _build_model,
        max_contexts: int = StrandsA2AExecutor.DEFAULT_MAX_CONTEXTS,
    ) -> None:
        self._verifier = verifier
        self._guardrail_loader = guardrail_loader
        self._gateway_token_provider = gateway_token_provider
        self._gateway_client_factory = gateway_client_factory
        self._model_factory = model_factory
        # Per-context verified identity + guardrail, set in execute() and read by
        # the agent factory the base class invokes for that context.
        self._pending: dict[str, dict[str, Any]] = {}
        super().__init__(agent_factory=self._build_agent_for_context, max_contexts=max_contexts)

    async def execute(self, context: Any, event_queue: Any) -> None:
        """Gate the request, then delegate the assessment to the base executor.

        On any rejection the assessment never runs: the check raises before
        ``super().execute`` and is surfaced as the matching JSON-RPC error.
        """
        message = _get(context, "message")
        try:
            claims = verify_request_identity(message, verifier=self._verifier)
            validate_requested_skill(read_requested_skill(message))
            guardrail_config = ensure_guardrail_config(loader=self._guardrail_loader)
        except FraudRequestRejected as exc:
            raise _to_server_error(exc) from exc
        except GuardrailUnavailableError as exc:
            # Guardrail cannot be applied → block the invocation (Req 7.5).
            raise ServerError(error=InternalError(message=str(exc))) from exc

        context_id = _get(context, "context_id") or ""
        self._pending[context_id] = {
            "user_id": claims["sub"],
            "guardrail_config": guardrail_config,
            "session_id": context_id,
        }
        try:
            await super().execute(context, event_queue)
        finally:
            self._pending.pop(context_id, None)

    def _build_agent_for_context(self, context_id: str) -> Agent:
        """Build the per-context agent bound to the request's verified identity."""
        pending = self._pending.get(context_id)
        if pending is None:
            # Defensive: the base class should only call this within execute(),
            # after the identity has been bound.
            raise ServerError(error=InternalError(message="No verified identity bound for A2A context"))
        return create_fraud_research_agent(
            context_id,
            user_id=pending["user_id"],
            guardrail_config=pending["guardrail_config"],
            session_id=pending.get("session_id"),
            gateway_token_provider=self._gateway_token_provider,
            gateway_client_factory=self._gateway_client_factory,
            model_factory=self._model_factory,
        )


def build_published_agent_card(url: str | None = None) -> AgentCard:
    """Build the A2A ``AgentCard`` advertised by this runtime.

    Advertises exactly the ``fraud_research_assessment`` skill (Req 2.2, 6.4). The
    ``url`` defaults to a placeholder; ``serve_a2a`` folds in the real invocation
    URL from ``AGENTCORE_RUNTIME_URL`` when the platform sets it.
    """
    return AgentCard(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        version=AGENT_VERSION,
        url=url or DEFAULT_ADVERTISED_URL,
        preferred_transport=PREFERRED_TRANSPORT,
        capabilities=AgentCapabilities(streaming=True),
        default_input_modes=list(DEFAULT_INPUT_MODES),
        default_output_modes=list(DEFAULT_OUTPUT_MODES),
        skills=build_agent_skills(),
    )


def main() -> None:
    """Start the gated A2A server on port 9000 (the AgentCore A2A contract).

    Serves the single-skill agent card and routes every ``message/send`` through
    :class:`FraudResearchExecutor`, which verifies identity, validates the
    capability, and enforces the guardrail before any assessment runs.
    """
    logger.info("[FRAUD] Starting Trinity Fraud & Research A2A server on port %d", A2A_PORT)
    executor = FraudResearchExecutor()
    serve_a2a(executor, agent_card=build_published_agent_card())


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _to_server_error(exc: FraudRequestRejected) -> ServerError:
    """Map a request rejection to the matching JSON-RPC authorization error."""
    if exc.reason == "capability":
        return ServerError(error=UnsupportedOperationError(message=exc.detail))
    return ServerError(error=InvalidRequestError(message=exc.detail))


def _coerce_to_dict(model_output: Any) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from varied model-output shapes."""
    if isinstance(model_output, dict):
        return model_output

    text = _extract_text(model_output)
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            parsed = json.loads(stripped)
        except ValueError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _extract_text(raw: Any) -> str:
    """Extract response text from a string, dict, or result-like object."""
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw

    message = _get(raw, "message")
    if message is None and isinstance(raw, dict):
        message = raw.get("message", raw)

    parts = _get(message, "content") or _get(message, "parts")
    if isinstance(parts, list):
        texts = [str(part_text) for part in parts if (part_text := _get(part, "text")) is not None]
        if texts:
            return "".join(texts)

    text = _get(message, "text")
    if isinstance(text, str):
        return text

    return str(message if message is not None else raw)


def _coerce_risk_score(value: Any) -> int:
    """Coerce a model-supplied risk score into an integer in [0, 100]."""
    if isinstance(value, bool):
        # bool is an int subclass; treat it as "not a real score".
        return _DEFAULT_RISK_SCORE
    if isinstance(value, (int, float)):
        score = int(value)
    elif isinstance(value, str):
        try:
            score = int(float(value.strip()))
        except (ValueError, AttributeError):
            return _DEFAULT_RISK_SCORE
    else:
        return _DEFAULT_RISK_SCORE
    return max(_MIN_RISK_SCORE, min(_MAX_RISK_SCORE, score))


def _coerce_str_list(value: Any) -> list[str]:
    """Coerce a model-supplied signals value into a list of strings."""
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value if item is not None]
    return []


def _get(obj: Any, key: str) -> Any:
    """Read ``key`` from a mapping or object attribute, tolerating either."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


# ``ADVERTISED_SKILLS`` is re-exported for the caller-side contract/tests so the
# advertised capability set has a single import site.
__all__ = [
    "ACTING_AGENT_ID",
    "ADVERTISED_SKILLS",
    "FraudRequestRejected",
    "FraudResearchExecutor",
    "GuardrailUnavailableError",
    "VALID_ASSESSMENTS",
    "build_assessment_artifact",
    "build_published_agent_card",
    "create_fraud_research_agent",
    "ensure_guardrail_config",
    "main",
    "read_requested_skill",
    "validate_requested_skill",
    "verify_request_identity",
]


if __name__ == "__main__":
    main()
