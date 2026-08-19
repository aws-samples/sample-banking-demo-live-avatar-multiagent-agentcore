"""Caller-side A2A client for the account-opening → fraud-research hop.

This module owns the *calling* half of the agent-to-agent (A2A) protocol: it
discovers a callee agent from its published agent card and then invokes it over
JSON-RPC `message/send`, forwarding the requesting customer's verified identity
assertion in the message metadata. It is reused by both the fraud hop and the
section-researcher fan-out.

The design deliberately keeps the pure logic seams separated from the network so
they can be tested with fakes (no deploy required):

- ``AgentCard`` — parse/serialize a published agent card (Property 1).
- ``endpoint_from_card`` — extract the invocation endpoint from a discovered
  card, never a static value (Property 2).
- ``build_a2a_request`` — build the JSON-RPC envelope + transport headers,
  carrying the applicant details and a non-empty bearer (Property 4), plus the
  forwarded ``identity_context`` metadata (Property 5).
- ``map_error_to_hop`` — the single funnel every failure path runs through,
  producing a typed ``A2AHopError`` that names the hop (Property 3).

``fetch_agent_card`` / ``invoke_a2a`` / ``consult_fraud_research`` compose those
seams. Each takes an injectable ``agent_factory`` so tests can substitute a fake
client that records call order and timestamps. The default factory builds a
minimal JSON-RPC client (httpx imported lazily so this module compiles and lints
without the optional A2A extras installed) rather than the Strands ``A2AAgent``
wrapper — the wrapper rejects dict input and silently drops message ``metadata``,
but the callees require the forwarded ``metadata.identity_context`` on the wire.

Discovery is always attempted strictly before invocation, and any
discovery/precondition failure raises before a single invocation is issued and
halts the dependent account-opening decision — a visible failure is preferable
to a fabricated assessment.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, runtime_checkable
from urllib.parse import quote

from utils.identity_context import build_identity_context

logger = logging.getLogger(__name__)

# JSON-RPC error code AgentCore returns for a transient conflict that the caller
# should retry (per the AgentCore A2A protocol contract) before giving up.
RETRYABLE_CONFLICT_CODE = -32054

# Retry policy for RetryableConflictException — short exponential backoff.
_MAX_RETRIES = 3
_INITIAL_BACKOFF_SEC = 0.5
_BACKOFF_MULTIPLIER = 2.0

# Well-known agent-card path served by an A2A runtime.
AGENT_CARD_PATH = ".well-known/agent-card.json"

# Transport header AgentCore uses to isolate A2A sessions.
SESSION_ID_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"

# Valid `kind` values for A2AHopError. Kept as a frozenset so callers/tests can
# assert against the closed set.
A2A_ERROR_KINDS = frozenset({"discovery", "invoke", "timeout", "network", "auth", "tracing"})


# ─── Typed errors ─────────────────────────────────────────────────────────────


class A2AHopError(Exception):
    """A failure of the A2A hop that names the hop as the failing step.

    Every caller-side failure funnels through :func:`map_error_to_hop` into this
    type so the account-opening flow can surface an error state that identifies
    the A2A collaboration as the failing step (Req 4.4) and, when the failure
    prevents a trustworthy assessment, halt the dependent decision (Req 3.3,
    4.5, 8.5).

    Attributes:
        step: Always ``"a2a"`` — identifies the hop.
        kind: One of :data:`A2A_ERROR_KINDS` describing the failure class.
        detail: Human-readable detail for logs/telemetry.
        halts_decision: ``True`` when the failure must halt the dependent
            account-opening decision (the default for the fraud hop).
    """

    def __init__(self, kind: str, detail: str, *, halts_decision: bool = True) -> None:
        if kind not in A2A_ERROR_KINDS:
            raise ValueError(f"Unknown A2AHopError kind: {kind!r}. Expected one of {sorted(A2A_ERROR_KINDS)}.")
        self.step = "a2a"
        self.kind = kind
        self.detail = detail
        self.halts_decision = halts_decision
        super().__init__(f"[a2a:{kind}] {detail}")


class A2ADiscoveryError(Exception):
    """Raised when the callee's agent card cannot be retrieved or is invalid.

    Discovery failures are mapped to ``A2AHopError(kind="discovery")`` by the
    consultation entry point, which issues zero invocations in that case.
    """


class A2AInvocationError(Exception):
    """A JSON-RPC error returned by the callee.

    Exposes ``code`` so :func:`_jsonrpc_error_code` (and therefore the
    ``-32054 RetryableConflictException`` retry loop) can classify it.
    """

    def __init__(self, code: int | None, message: str, data: Any = None) -> None:
        self.code = code
        self.data = data
        super().__init__(f"JSON-RPC error {code}: {message}")


# ─── Data models ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AgentCard:
    """A discovered A2A agent card.

    The wire document uses camelCase keys (``protocolVersion``,
    ``preferredTransport``, ``defaultInputModes``, ``defaultOutputModes``);
    :meth:`to_dict` emits that shape and :meth:`from_dict` reads it (tolerating
    snake_case too), so ``AgentCard.from_dict(card.to_dict()) == card``.
    """

    name: str
    url: str
    version: str = ""
    description: str = ""
    protocol_version: str = ""
    preferred_transport: str = "JSONRPC"
    capabilities: dict[str, Any] = field(default_factory=dict)
    default_input_modes: list[str] = field(default_factory=lambda: ["text"])
    default_output_modes: list[str] = field(default_factory=lambda: ["text"])
    skills: tuple[dict[str, Any], ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentCard":
        """Parse a published agent-card document.

        Raises:
            A2ADiscoveryError: If the document is not a mapping, or is missing a
                non-empty ``name``/``url`` or at least one skill. A card that
                cannot construct a valid invocation is a discovery failure.
        """
        if not isinstance(data, dict):
            raise A2ADiscoveryError(f"Agent card is not a JSON object: {type(data).__name__}")

        name = _first_str(data, "name")
        url = _first_str(data, "url")
        skills_raw = data.get("skills") or []

        if not name:
            raise A2ADiscoveryError("Agent card is missing a non-empty 'name'")
        if not url:
            raise A2ADiscoveryError("Agent card is missing a non-empty 'url'")
        if not isinstance(skills_raw, (list, tuple)) or len(skills_raw) == 0:
            raise A2ADiscoveryError("Agent card must declare at least one skill")

        return cls(
            name=name,
            url=url,
            version=_first_str(data, "version"),
            description=_first_str(data, "description"),
            protocol_version=_first_str(data, "protocolVersion", "protocol_version"),
            preferred_transport=_first_str(data, "preferredTransport", "preferred_transport") or "JSONRPC",
            capabilities=dict(data.get("capabilities") or {}),
            default_input_modes=list(data.get("defaultInputModes") or data.get("default_input_modes") or ["text"]),
            default_output_modes=list(data.get("defaultOutputModes") or data.get("default_output_modes") or ["text"]),
            skills=tuple(dict(skill) for skill in skills_raw),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize back to the wire (camelCase) agent-card shape."""
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "url": self.url,
            "protocolVersion": self.protocol_version,
            "preferredTransport": self.preferred_transport,
            "capabilities": dict(self.capabilities),
            "defaultInputModes": list(self.default_input_modes),
            "defaultOutputModes": list(self.default_output_modes),
            "skills": [dict(skill) for skill in self.skills],
        }


@dataclass(frozen=True)
class A2ARequest:
    """A built A2A request: the invocation endpoint, headers, and JSON-RPC body."""

    endpoint: str
    headers: dict[str, str]
    payload: dict[str, Any]

    @property
    def message(self) -> dict[str, Any]:
        """The ``params.message`` block that is sent to the callee."""
        return self.payload["params"]["message"]


@dataclass(frozen=True)
class A2AResult:
    """The parsed result of an A2A invocation.

    Attributes:
        text: The response text extracted from the callee's result.
        data: The response parsed as JSON when the text is a JSON object (the
            fraud assessment artifact), otherwise ``None``.
        raw: The raw result object returned by the underlying client.
    """

    text: str
    data: dict[str, Any] | None
    raw: Any


# ─── Injectable client seam ─────────────────────────────────────────────────────


@runtime_checkable
class A2AClient(Protocol):
    """The subset of the Strands ``A2AAgent`` surface this module depends on.

    Tests supply a fake implementing these two async methods to record call
    order/timestamps without any network.
    """

    async def get_agent_card(self) -> Any: ...

    async def invoke_async(self, prompt: Any) -> Any: ...


# A factory that builds an :class:`A2AClient` for a resolved endpoint + bearer.
AgentFactory = Callable[..., A2AClient]


class _JsonRpcA2AClient:
    """Minimal JSON-RPC ``message/send`` client for an A2A runtime endpoint.

    This is the default :data:`AgentFactory` product. It deliberately does NOT
    use the Strands ``A2AAgent`` wrapper: that wrapper's input converter accepts
    only strings/content blocks — our metadata-bearing wire message (a dict)
    made every invocation fail with ``Unsupported input type: <class 'dict'>``
    — and even for accepted inputs it rebuilds the message and silently drops
    ``metadata``, while both callees hard-require the forwarded
    ``metadata.identity_context`` to run at all (Req 5.1/5.4). Sending the
    JSON-RPC envelope we already build keeps the identity assertion on the wire
    exactly as the callee executors read it.
    """

    def __init__(self, endpoint: str, *, bearer: str, timeout: int = 300) -> None:
        self._endpoint = endpoint
        self._bearer = bearer
        self._timeout = timeout
        # Transport headers beyond Authorization (e.g. the AgentCore session
        # header). Set by `invoke_a2a` from the built request.
        self.extra_headers: dict[str, str] = {}

    def _headers(self) -> dict[str, str]:
        return {**self.extra_headers, "Authorization": f"Bearer {self._bearer}"}

    async def get_agent_card(self) -> dict[str, Any]:
        """GET the well-known agent card through the invocation endpoint."""
        import httpx  # noqa: PLC0415 — deferred so the module imports without A2A extras

        base = self._endpoint if self._endpoint.endswith("/") else f"{self._endpoint}/"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(f"{base}{AGENT_CARD_PATH}", headers=self._headers())
            response.raise_for_status()
            return response.json()

    async def invoke_async(self, prompt: Any) -> Any:
        """POST a JSON-RPC ``message/send`` carrying ``prompt`` as the message.

        ``prompt`` is the fully built ``params.message`` block (including the
        ``metadata.identity_context``). A JSON-RPC ``error`` in the response is
        raised as :class:`A2AInvocationError` with its ``code`` intact so the
        retryable-conflict loop in :func:`invoke_a2a` can classify it.
        """
        import httpx  # noqa: PLC0415 — deferred so the module imports without A2A extras

        payload = {
            "jsonrpc": "2.0",
            "id": f"req-{uuid.uuid4()}",
            "method": "message/send",
            "params": {"message": prompt},
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(self._endpoint, json=payload, headers=self._headers())
            response.raise_for_status()
            body = response.json()

        error = body.get("error") if isinstance(body, dict) else None
        if error is not None:
            raise A2AInvocationError(
                _code_from_error_obj(error),
                str(error.get("message", "")) if isinstance(error, dict) else str(error),
                data=error.get("data") if isinstance(error, dict) else None,
            )
        return body.get("result") if isinstance(body, dict) else body


def _default_agent_factory(endpoint: str, *, bearer: str, timeout: int = 300) -> A2AClient:
    """Build the default JSON-RPC A2A client for a resolved endpoint + bearer."""
    return _JsonRpcA2AClient(endpoint, bearer=bearer, timeout=timeout)


# ─── Pure seams ─────────────────────────────────────────────────────────────────


def runtime_invocation_url(runtime_arn: str, *, region: str | None = None) -> str:
    """Build the AgentCore runtime invocation base URL for a runtime ARN.

    The ARN is URL-encoded into the path. The returned URL ends with
    ``/invocations/`` so the well-known card path can be appended for discovery.
    """
    if not runtime_arn or not runtime_arn.strip():
        raise A2AHopError("invoke", "Missing fraud runtime ARN; cannot construct invocation URL")

    resolved_region = region or os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
    encoded_arn = quote(runtime_arn, safe="")
    return f"https://bedrock-agentcore.{resolved_region}.amazonaws.com/runtimes/{encoded_arn}/invocations/"


def agent_card_url(runtime_arn: str, *, region: str | None = None) -> str:
    """Build the well-known agent-card URL for a runtime ARN (discovery target)."""
    return f"{runtime_invocation_url(runtime_arn, region=region)}{AGENT_CARD_PATH}"


def endpoint_from_card(card: AgentCard) -> str:
    """Return the invocation endpoint declared by a discovered card.

    The endpoint is always taken from the discovered card (Req 3.2 / Property 2),
    never from a static/hardcoded value.
    """
    if not card.url or not card.url.strip():
        raise A2ADiscoveryError("Discovered agent card has no invocation 'url'")
    return card.url


def build_applicant_prompt(applicant: dict[str, Any]) -> str:
    """Build the assessment instruction + serialized synthetic applicant fields.

    The applicant fields are embedded verbatim (as JSON) so the callee — and the
    property test (Property 4) — can confirm every required field crossed the
    hop.
    """
    applicant_json = json.dumps(applicant, sort_keys=True, default=str)
    return (
        "Assess the following synthetic account-opening applicant for fraud and "
        "research signals. Use only the research tools available to you and return "
        "a JSON assessment.\n\n"
        f"Applicant: {applicant_json}"
    )


def build_a2a_message(applicant: dict[str, Any], *, message_id: str | None = None) -> dict[str, Any]:
    """Build the ``params.message`` block carrying the applicant details."""
    return {
        "role": "user",
        "parts": [{"kind": "text", "text": build_applicant_prompt(applicant)}],
        "messageId": message_id or str(uuid.uuid4()),
    }


def build_a2a_request(
    card: AgentCard,
    message: dict[str, Any],
    *,
    bearer: str,
    identity_context: dict[str, str],
    session_id: str | None = None,
    request_id: str | None = None,
) -> A2ARequest:
    """Build the JSON-RPC ``message/send`` request for a discovered card.

    - The invocation endpoint is the discovered card's ``url`` (Property 2).
    - The transport headers carry a non-empty ``Authorization`` bearer that
      authenticates the *calling agent* (Property 4 / Req 6.1).
    - The forwarded customer ``identity_context`` is attached to the message
      metadata so the callee re-verifies it (Property 5 / Req 5.1).

    Raises:
        A2AHopError: If the machine bearer is empty (``kind="auth"``) — an A2A
            request must never be sent without a caller credential.
    """
    if not bearer or not bearer.strip():
        raise A2AHopError("auth", "Missing machine bearer credential for the A2A call")

    endpoint = endpoint_from_card(card)

    wire_message = dict(message)
    wire_message["metadata"] = dict(identity_context)

    headers = {"Authorization": f"Bearer {bearer}"}
    if session_id:
        headers[SESSION_ID_HEADER] = session_id

    payload = {
        "jsonrpc": "2.0",
        "id": request_id or f"req-{uuid.uuid4()}",
        "method": "message/send",
        "params": {"message": wire_message},
    }
    return A2ARequest(endpoint=endpoint, headers=headers, payload=payload)


def map_error_to_hop(
    exc: BaseException,
    *,
    default_kind: str = "invoke",
    halts_decision: bool = True,
    detail: str | None = None,
) -> A2AHopError:
    """Funnel any failure into a typed :class:`A2AHopError`.

    Every caller-side failure path runs through this helper so the produced
    ``kind`` is derived consistently. Already-typed ``A2AHopError`` instances are
    returned unchanged; ``A2ADiscoveryError`` maps to ``kind="discovery"``;
    everything else is classified from the exception (timeout / network / auth)
    falling back to ``default_kind``.
    """
    if isinstance(exc, A2AHopError):
        return exc

    resolved_detail = detail or str(exc) or exc.__class__.__name__

    if isinstance(exc, A2ADiscoveryError):
        return A2AHopError("discovery", resolved_detail, halts_decision=halts_decision)

    kind = _classify_exception(exc, default_kind)
    return A2AHopError(kind, resolved_detail, halts_decision=halts_decision)


# ─── Composed operations (network) ──────────────────────────────────────────────


async def fetch_agent_card(
    runtime_arn: str,
    bearer: str,
    *,
    region: str | None = None,
    agent_factory: AgentFactory | None = None,
) -> AgentCard:
    """Discover the callee agent card through the runtime invocation URL.

    GETs ``/.well-known/agent-card.json`` through the runtime invocation URL
    (URL-encoded ARN). Any failure — network, non-2xx, or an invalid card — is
    raised as :class:`A2ADiscoveryError` (Req 3.3).
    """
    factory = agent_factory or _default_agent_factory
    endpoint = runtime_invocation_url(runtime_arn, region=region)

    try:
        client = factory(endpoint, bearer=bearer)
        raw_card = await client.get_agent_card()
    except A2ADiscoveryError:
        raise
    except Exception as exc:  # noqa: BLE001 — every discovery failure is a discovery error
        logger.warning("Agent card discovery failed for %s: %s", endpoint, exc)
        raise A2ADiscoveryError(f"Failed to retrieve agent card from {endpoint}: {exc}") from exc

    return AgentCard.from_dict(_card_to_dict(raw_card))


async def invoke_a2a(
    card: AgentCard,
    message: dict[str, Any],
    *,
    bearer: str,
    identity_context: dict[str, str],
    session_id: str | None = None,
    agent_factory: AgentFactory | None = None,
) -> A2AResult:
    """Invoke the callee over JSON-RPC ``message/send`` using a discovered card.

    Builds the Strands ``A2AAgent`` client for the discovered endpoint, attaches
    the machine bearer + forwarded ``identity_context`` metadata, and sends the
    request. A ``-32054 RetryableConflictException`` is retried with short
    exponential backoff before failing; every other JSON-RPC/transport failure is
    mapped to :class:`A2AHopError` (Req 4.4).
    """
    factory = agent_factory or _default_agent_factory
    request = build_a2a_request(
        card,
        message,
        bearer=bearer,
        identity_context=identity_context,
        session_id=session_id,
    )

    backoff = _INITIAL_BACKOFF_SEC
    attempt = 0
    while True:
        try:
            client = factory(request.endpoint, bearer=bearer)
            # The default client also carries the built transport headers (the
            # AgentCore session-isolation header). Injected fakes don't.
            if isinstance(client, _JsonRpcA2AClient):
                client.extra_headers = dict(request.headers)
            raw = await client.invoke_async(request.message)
            return _parse_result(raw)
        except A2AHopError:
            raise
        except Exception as exc:  # noqa: BLE001 — funnel all failures through the mapper
            code = _jsonrpc_error_code(exc)
            if code == RETRYABLE_CONFLICT_CODE and attempt < _MAX_RETRIES:
                logger.info(
                    "A2A invoke hit RetryableConflictException (%s); retry %d/%d after %.1fs",
                    RETRYABLE_CONFLICT_CODE,
                    attempt + 1,
                    _MAX_RETRIES,
                    backoff,
                )
                await asyncio.sleep(backoff)
                attempt += 1
                backoff *= _BACKOFF_MULTIPLIER
                continue
            raise map_error_to_hop(exc)


async def consult_fraud_research(
    applicant: dict[str, Any],
    *,
    user_id: str,
    customer_jwt: str,
    session_id: str | None = None,
    runtime_arn: str | None = None,
    bearer: str | None = None,
    region: str | None = None,
    agent_factory: AgentFactory | None = None,
) -> dict[str, Any]:
    """Consult the fraud-research agent over A2A: discover strictly, then invoke.

    Discovery is always attempted before any invocation (Req 3.1). Any
    discovery/precondition failure — missing runtime ARN, missing customer
    assertion, or a card that cannot be retrieved — raises an
    ``A2AHopError(halts_decision=True)`` *before* a single invocation is issued,
    so the dependent account-opening decision is halted and zero invocations are
    made (Req 3.3, 4.5).

    Args:
        applicant: The synthetic applicant details to assess.
        user_id: The verified customer ``sub`` (for logging/telemetry only; the
            identity carried on the wire is the forwarded ``customer_jwt``).
        customer_jwt: The requesting customer's verified user-pool JWT, forwarded
            as ``metadata.identity_context`` for the callee to re-verify.
        session_id: Optional A2A session id for isolation.
        runtime_arn: Fraud runtime ARN; defaults to ``FRAUD_AGENT_RUNTIME_ARN``.
        bearer: Machine caller bearer; minted from the caller's M2M client when
            not supplied.
        region: Optional AWS region override.
        agent_factory: Injectable A2A client factory (tests supply a fake).

    Returns:
        The parsed fraud/research assessment (the callee's JSON artifact), or the
        response text under an ``assessment_text`` key if it was not JSON.

    Raises:
        A2AHopError: On any discovery/precondition/invoke failure, with
            ``halts_decision=True``.
    """
    resolved_arn = runtime_arn or os.environ.get("FRAUD_AGENT_RUNTIME_ARN")
    if not resolved_arn:
        # Precondition failure: the invocation cannot occur (Req 4.5). Raise
        # before discovery so zero invocations are issued.
        raise A2AHopError("invoke", "FRAUD_AGENT_RUNTIME_ARN is not configured", halts_decision=True)

    if not customer_jwt or not customer_jwt.strip():
        raise A2AHopError("auth", "No verified customer identity assertion to forward", halts_decision=True)

    try:
        identity_context = build_identity_context(customer_jwt)
    except ValueError as exc:
        raise A2AHopError("auth", f"Invalid customer identity assertion: {exc}", halts_decision=True) from exc

    resolved_bearer = bearer or _resolve_caller_bearer()

    logger.info("Consulting fraud-research agent over A2A for user %s (session=%s)", user_id, session_id)

    # Discovery strictly before invoke (Req 3.1). A discovery failure surfaces as
    # A2AHopError(kind="discovery") and issues zero invocations.
    try:
        card = await fetch_agent_card(
            resolved_arn,
            resolved_bearer,
            region=region,
            agent_factory=agent_factory,
        )
    except A2ADiscoveryError as exc:
        raise map_error_to_hop(exc, halts_decision=True) from exc

    message = build_a2a_message(applicant)
    result = await invoke_a2a(
        card,
        message,
        bearer=resolved_bearer,
        identity_context=identity_context,
        session_id=session_id,
        agent_factory=agent_factory,
    )

    if result.data is not None:
        return result.data
    return {"assessment_text": result.text}


# ─── Internal helpers ────────────────────────────────────────────────────────────


def _resolve_caller_bearer() -> str:
    """Mint the machine caller bearer for the A2A call.

    Reads the caller's M2M client SSM parameter/secret names from the
    environment, defaulting to the shared machine client for the stack. Imported
    lazily so this module does not require AWS deps to import.
    """
    from utils.auth import get_agent_access_token  # noqa: PLC0415 — deferred AWS dependency

    stack_name = os.environ.get("STACK_NAME", "")
    client_id_param = os.environ.get("FRAUD_CALLER_CLIENT_ID_PARAM", f"/{stack_name}/machine_client_id")
    secret_param = os.environ.get("FRAUD_CALLER_CLIENT_SECRET_PARAM", f"/{stack_name}/machine_client_secret")
    return get_agent_access_token(client_id_param, secret_param)


def resolve_caller_bearer() -> str:
    """Public accessor for the machine caller bearer.

    Reused by the section-researcher A2A fan-out, which authenticates to its
    runtime with the same caller credential as the fraud hop (least privilege —
    one shared machine caller principal for both in-account A2A hops).
    """
    return _resolve_caller_bearer()


def _classify_exception(exc: BaseException, default_kind: str) -> str:
    """Classify a raw exception into an A2AHopError ``kind``."""
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"

    name = exc.__class__.__name__.lower()
    text = str(exc).lower()
    haystack = f"{name} {text}"

    status = _http_status(exc)
    if status in (401, 403) or "unauthorized" in haystack or "forbidden" in haystack:
        return "auth"
    if "timeout" in haystack or "timed out" in haystack:
        return "timeout"
    if any(token in haystack for token in ("connect", "network", "transport", "dns", "unreachable")):
        return "network"
    return default_kind if default_kind in A2A_ERROR_KINDS else "invoke"


def _http_status(exc: BaseException) -> int | None:
    """Best-effort extraction of an HTTP status code from an exception."""
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) else None


def _jsonrpc_error_code(exc: BaseException) -> int | None:
    """Best-effort extraction of a JSON-RPC error code from an exception.

    Looks at a top-level ``code`` attribute, an ``error`` mapping/attribute with
    a ``code``, and a JSON ``error`` body on an attached ``response``.
    """
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code

    error = getattr(exc, "error", None)
    error_code = _code_from_error_obj(error)
    if error_code is not None:
        return error_code

    response = getattr(exc, "response", None)
    if response is not None:
        body = _response_json(response)
        if isinstance(body, dict):
            return _code_from_error_obj(body.get("error"))
    return None


def _code_from_error_obj(error: Any) -> int | None:
    """Extract a ``code`` int from a JSON-RPC error mapping or object."""
    if isinstance(error, dict):
        value = error.get("code")
        return value if isinstance(value, int) else None
    value = getattr(error, "code", None)
    return value if isinstance(value, int) else None


def _response_json(response: Any) -> Any:
    """Parse a response body as JSON, tolerating both callables and attributes."""
    json_attr = getattr(response, "json", None)
    try:
        if callable(json_attr):
            return json_attr()
        text = getattr(response, "text", None)
        if isinstance(text, str) and text:
            return json.loads(text)
    except (ValueError, TypeError):
        return None
    return None


def _parse_result(raw: Any) -> A2AResult:
    """Extract text (and any JSON payload) from a callee result object."""
    text = _extract_text(raw)
    data: dict[str, Any] | None = None
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                data = parsed
        except ValueError:
            data = None
    return A2AResult(text=text, data=data, raw=raw)


def _extract_text(raw: Any) -> str:
    """Best-effort extraction of response text from varied result shapes.

    Handles plain strings, dict payloads, Strands ``AgentResult``-like objects
    exposing ``.message``, and A2A message ``parts`` carrying ``text``.
    """
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw

    # A JSON-RPC `message/send` result can be a Task carrying the response in
    # its artifacts (the Strands server executor completes tasks that way).
    # Concatenate every text part across artifacts, in order.
    artifacts = _get(raw, "artifacts")
    if isinstance(artifacts, list):
        texts = []
        for artifact in artifacts:
            parts = _get(artifact, "parts")
            if isinstance(parts, list):
                texts.extend(str(part_text) for part in parts if (part_text := _get(part, "text")) is not None)
        if texts:
            return "".join(texts)

    message = getattr(raw, "message", None)
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


def _get(obj: Any, key: str) -> Any:
    """Read ``key`` from a mapping or object attribute, tolerating either."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _first_str(data: dict[str, Any], *keys: str) -> str:
    """Return the first present string value among ``keys`` (else empty string)."""
    for key in keys:
        value = data.get(key)
        if isinstance(value, str):
            return value
    return ""


def _card_to_dict(raw_card: Any) -> dict[str, Any]:
    """Normalize a discovered card object into a plain wire-shaped dict.

    Handles pydantic models (``model_dump(by_alias=True)``), plain dicts, and
    attribute-bearing objects.
    """
    if isinstance(raw_card, dict):
        return raw_card

    model_dump = getattr(raw_card, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(by_alias=True, exclude_none=True)
        except TypeError:
            return model_dump()

    to_dict = getattr(raw_card, "to_dict", None)
    if callable(to_dict):
        return to_dict()

    # Fall back to reading the known attributes off an arbitrary object.
    keys = (
        "name",
        "url",
        "version",
        "description",
        "protocolVersion",
        "preferredTransport",
        "capabilities",
        "defaultInputModes",
        "defaultOutputModes",
        "skills",
    )
    return {key: value for key in keys if (value := getattr(raw_card, key, None)) is not None}
