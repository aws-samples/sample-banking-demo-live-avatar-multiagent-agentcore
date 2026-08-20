"""Section-Researcher Agent — A2A server handler.

Exposes a Strands deep-research agent as an Agent-to-Agent (A2A) server, deployed
as its own AgentCore Runtime configured with ``protocolConfiguration: "A2A"``.
This is the callee for the orchestrator's parallel section fan-out
(``_run_parallel_research`` A2A branch, gated by
``features.a2a_parallel_research``): each research shard becomes one A2A
invocation to this runtime, forwarding the same customer ``identity_context``.

``serve_a2a`` runs a stateless streamable HTTP server on ``0.0.0.0:9000`` at root
path ``/``, serves the agent card at ``/.well-known/agent-card.json``, exposes
``/ping``, sets ``AGENTCORE_RUNTIME_URL``, and propagates Bedrock headers.

Per inbound request the :class:`SectionResearchExecutor`:

1. reads ``message.metadata.identity_context`` and verifies the forwarded
   customer JWT, rejecting an absent/invalid/expired assertion with a JSON-RPC
   authorization error so the research never runs (Req 5.4, 6.3);
2. rejects any requested skill/method other than the single advertised
   ``section_research`` capability (Req 6.4);
3. binds the verified customer ``sub`` into a :class:`UserScopeHook` so Gateway
   tool calls carry the propagated identity (Req 5.3, 7.1);
4. runs the research using research tools only and returns the per-worker
   researcher JSON shape the orchestrator's merge already consumes.

The gating seams mirror the fraud agent (task 6) so the same test approach
applies with the model and Gateway MCP client mocked.
"""

from __future__ import annotations

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
    AGENT_DESCRIPTION,
    AGENT_NAME,
    AGENT_VERSION,
    DEFAULT_INPUT_MODES,
    DEFAULT_OUTPUT_MODES,
    PREFERRED_TRANSPORT,
    SECTION_RESEARCH_SKILL_ID,
    build_agent_skills,
)
from bedrock_agentcore.runtime import serve_a2a
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
from utils.mcp_client import create_gateway_mcp_client as build_timebound_gateway_client
from utils.ssm import get_ssm_parameter
from utils.tool_guard import UserScopeHook

logger = logging.getLogger(__name__)

# AgentCore's A2A proxy requires the container to serve on port 9000 at "/".
A2A_PORT = 9000

# Default model id; overridden per-deployment via the MODEL_ID env var.
DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-6"

# Acting-agent id this callee tags its spans with.
ACTING_AGENT_ID = "section_researcher"

# Message-metadata keys a caller may use to name a requested capability. Any
# value other than the single advertised skill is rejected (Req 6.4).
_REQUESTED_SKILL_KEYS: tuple[str, ...] = ("skill", "skill_id")

# Placeholder invocation URL advertised until the platform sets
# AGENTCORE_RUNTIME_URL (which serve_a2a folds into the served card).
DEFAULT_ADVERTISED_URL = f"http://localhost:{A2A_PORT}/"


class SectionRequestRejected(Exception):
    """An inbound A2A request is rejected before the research runs.

    Raised by the gating seams for an unverified customer identity
    (``reason="identity"``) or an unauthorized capability
    (``reason="capability"``). The executor maps it to the matching JSON-RPC
    error so the research never runs (Req 5.4, 6.4).
    """

    def __init__(self, detail: str, *, reason: str) -> None:
        self.detail = detail
        self.reason = reason
        super().__init__(detail)


# ─── Configuration / dependency builders ──────────────────────────────────────


def _load_system_prompt() -> str:
    """Read the section-researcher persona prompt shipped with the package."""
    prompt_path = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
    with open(prompt_path, encoding="utf-8") as prompt_file:
        return prompt_file.read()


def section_gateway_access_token() -> str:
    """Mint the Gateway access token for the section researcher's M2M client.

    Reads the client's SSM parameter / secret names from the environment
    (``SECTION_RESEARCHER_CLIENT_ID_PARAM`` / ``SECTION_RESEARCHER_CLIENT_SECRET_PARAM``),
    defaulting to the shared machine client for the stack. Reusing the shared
    caller keeps the section fan-out least-privilege without minting a second
    dedicated principal for the demo.
    """
    stack_name = os.environ.get("STACK_NAME", "")
    client_id_param = os.environ.get("SECTION_RESEARCHER_CLIENT_ID_PARAM", f"/{stack_name}/machine_client_id")
    secret_param = os.environ.get("SECTION_RESEARCHER_CLIENT_SECRET_PARAM", f"/{stack_name}/machine_client_secret")
    return get_agent_access_token(client_id_param, secret_param)


def create_gateway_mcp_client(access_token: str) -> MCPClient:
    """Create an MCP client for the AgentCore Gateway with OAuth2 auth."""
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    logger.info("[SECTION] Gateway URL from SSM: %s", gateway_url)

    # TimeboundMCPClient bounds every gateway tool call with a hard read
    # timeout so a wedged call (POST answered 202, result never streamed) can
    # never hang this researcher thread indefinitely.
    return build_timebound_gateway_client(gateway_url, access_token, prefix="gateway")


def _load_guardrail_config() -> dict[str, str] | None:
    """Load the Bedrock guardrail config from SSM, or ``None`` if unavailable."""
    stack_name = os.environ.get("STACK_NAME", "")
    if not stack_name:
        return None
    try:
        guardrail_id = get_ssm_parameter(f"/{stack_name}/guardrail_id")
        guardrail_version = get_ssm_parameter(f"/{stack_name}/guardrail_version")
    except Exception as exc:  # noqa: BLE001 — any SSM failure means "no guardrail available"
        logger.warning("[SECTION] Guardrail config not available: %s", exc)
        return None
    if guardrail_id and guardrail_version:
        return {"guardrailIdentifier": guardrail_id, "guardrailVersion": guardrail_version}
    return None


def _build_model(guardrail_config: dict[str, str] | None, *, model_id: str | None = None) -> BedrockModel:
    """Build the Bedrock model, applying the guardrail when one is available."""
    resolved_model_id = model_id or os.environ.get("MODEL_ID", DEFAULT_MODEL_ID)
    if guardrail_config:
        return BedrockModel(model_id=resolved_model_id, temperature=0.1, guardrail_config=guardrail_config)
    return BedrockModel(model_id=resolved_model_id, temperature=0.1)


# ─── Per-request gating seams ─────────────────────────────────────────────────


def verify_request_identity(
    message: Any,
    *,
    verifier: Callable[[str], dict[str, Any]] = verify_user_pool_jwt,
) -> dict[str, Any]:
    """Verify the forwarded customer identity assertion on an inbound message.

    A missing/malformed/expired/bad-signature assertion is rejected so the
    research never runs (Req 5.4).
    """
    assertion = read_identity_context(message)
    if not assertion or not assertion.strip():
        raise SectionRequestRejected("A2A request is missing a verified customer identity assertion", reason="identity")
    try:
        claims = verifier(assertion)
    except IdentityVerificationError as exc:
        raise SectionRequestRejected(f"Customer identity verification failed: {exc}", reason="identity") from exc

    if not claims.get("sub"):
        raise SectionRequestRejected("Verified customer identity is missing a subject", reason="identity")
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

    A request that names no skill defaults to the single advertised capability
    and is allowed (Req 6.4).
    """
    if requested_skill is None:
        return
    if requested_skill != SECTION_RESEARCH_SKILL_ID:
        raise SectionRequestRejected(
            f"Unsupported skill/method {requested_skill!r}; this agent advertises only {SECTION_RESEARCH_SKILL_ID!r}",
            reason="capability",
        )


# ─── Agent construction ───────────────────────────────────────────────────────


def create_section_research_agent(
    context_id: str | None = None,
    *,
    user_id: str,
    session_id: str | None = None,
    gateway_token_provider: Callable[[], str] = section_gateway_access_token,
    gateway_client_factory: Callable[[str], Any] = create_gateway_mcp_client,
    guardrail_loader: Callable[[], dict[str, str] | None] = _load_guardrail_config,
    model_factory: Callable[[dict[str, str] | None], Any] = _build_model,
) -> Agent:
    """Construct the section-researcher Strands agent bound to one verified customer.

    Building a fresh agent per context/customer keeps concurrent callers isolated:
    each agent carries its own :class:`UserScopeHook`, so no identity from one
    request can bleed into another. Span attributes carry the customer ``sub``
    and the acting-agent id.
    """
    access_token = gateway_token_provider()
    gateway_client = gateway_client_factory(access_token)
    model = model_factory(guardrail_loader())

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


class SectionResearchExecutor(StrandsA2AExecutor):
    """A2A executor that gates every request before running the research.

    Subclasses :class:`StrandsA2AExecutor` (per-context concurrency + isolation)
    and overrides :meth:`execute` to verify the forwarded customer identity and
    validate the requested capability before delegating the streamed research to
    the base executor.
    """

    def __init__(
        self,
        *,
        verifier: Callable[[str], dict[str, Any]] = verify_user_pool_jwt,
        gateway_token_provider: Callable[[], str] = section_gateway_access_token,
        gateway_client_factory: Callable[[str], Any] = create_gateway_mcp_client,
        guardrail_loader: Callable[[], dict[str, str] | None] = _load_guardrail_config,
        model_factory: Callable[[dict[str, str] | None], Any] = _build_model,
        max_contexts: int = StrandsA2AExecutor.DEFAULT_MAX_CONTEXTS,
    ) -> None:
        self._verifier = verifier
        self._gateway_token_provider = gateway_token_provider
        self._gateway_client_factory = gateway_client_factory
        self._guardrail_loader = guardrail_loader
        self._model_factory = model_factory
        self._pending: dict[str, dict[str, Any]] = {}
        super().__init__(agent_factory=self._build_agent_for_context, max_contexts=max_contexts)

    async def execute(self, context: Any, event_queue: Any) -> None:
        """Gate the request, then delegate the research to the base executor."""
        message = _get(context, "message")
        try:
            claims = verify_request_identity(message, verifier=self._verifier)
            validate_requested_skill(read_requested_skill(message))
        except SectionRequestRejected as exc:
            raise _to_server_error(exc) from exc

        context_id = _get(context, "context_id") or ""
        self._pending[context_id] = {"user_id": claims["sub"], "session_id": context_id}
        try:
            await super().execute(context, event_queue)
        finally:
            self._pending.pop(context_id, None)

    def _build_agent_for_context(self, context_id: str) -> Agent:
        """Build the per-context agent bound to the request's verified identity."""
        pending = self._pending.get(context_id)
        if pending is None:
            raise ServerError(error=InternalError(message="No verified identity bound for A2A context"))
        return create_section_research_agent(
            context_id,
            user_id=pending["user_id"],
            session_id=pending.get("session_id"),
            gateway_token_provider=self._gateway_token_provider,
            gateway_client_factory=self._gateway_client_factory,
            guardrail_loader=self._guardrail_loader,
            model_factory=self._model_factory,
        )


def build_published_agent_card(url: str | None = None) -> AgentCard:
    """Build the A2A ``AgentCard`` advertised by this runtime.

    Advertises exactly the ``section_research`` skill. The ``url`` defaults to a
    placeholder; ``serve_a2a`` folds in the real invocation URL from
    ``AGENTCORE_RUNTIME_URL`` when the platform sets it.
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
    """Start the gated A2A server on port 9000 (the AgentCore A2A contract)."""
    logger.info("[SECTION] Starting Trinity Section Researcher A2A server on port %d", A2A_PORT)
    executor = SectionResearchExecutor()
    serve_a2a(executor, agent_card=build_published_agent_card())


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _to_server_error(exc: SectionRequestRejected) -> ServerError:
    """Map a request rejection to the matching JSON-RPC authorization error."""
    if exc.reason == "capability":
        return ServerError(error=UnsupportedOperationError(message=exc.detail))
    return ServerError(error=InvalidRequestError(message=exc.detail))


def _get(obj: Any, key: str) -> Any:
    """Read ``key`` from a mapping or object attribute, tolerating either."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


__all__ = [
    "ACTING_AGENT_ID",
    "SectionRequestRejected",
    "SectionResearchExecutor",
    "build_published_agent_card",
    "create_section_research_agent",
    "main",
    "read_requested_skill",
    "validate_requested_skill",
    "verify_request_identity",
]


if __name__ == "__main__":
    main()
