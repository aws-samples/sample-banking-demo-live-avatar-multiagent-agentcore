"""On-the-wire identity-context shape for the A2A hop.

The account-opening agent forwards the requesting customer's *already-verified*
Cognito user-pool JWT to the callee (the fraud-research agent) inside the A2A
message metadata, alongside the acting-agent id. The callee re-verifies the
assertion cryptographically with `auth.verify_user_pool_jwt`.

This module owns exactly one shape so the caller and callee never drift:

    message.metadata = {
        "identity_context": "<customer verified user-pool JWT>",
        "acting_agent": "<caller agent id>",
    }

`build_identity_context` is the caller-side producer; `read_identity_context`
is the callee-side extractor. Neither function verifies the JWT — verification
is the callee's job (`verify_user_pool_jwt`). Keeping the identity derived from
a verified JWT (never a model-supplied `user_id`) is what makes the propagated
identity trustworthy: the customer identity is only ever the forwarded token,
so a model-generated value has no way to override it.
"""

from __future__ import annotations

from typing import Any

# Metadata keys carried on the A2A message. Centralized so the producer and
# extractor cannot disagree on spelling.
IDENTITY_CONTEXT_KEY = "identity_context"
ACTING_AGENT_KEY = "acting_agent"

# Default acting-agent id for the account-opening caller.
DEFAULT_ACTING_AGENT = "ai_agent"


def build_identity_context(customer_jwt: str, *, acting_agent: str = DEFAULT_ACTING_AGENT) -> dict[str, str]:
    """Build the ``message.metadata`` identity-context block for an A2A request.

    The customer identity carried across the hop is *only* the forwarded,
    already-verified customer JWT — there is no `user_id` argument, so a
    model-supplied value can never override the verified identity.

    Args:
        customer_jwt: The requesting customer's verified Cognito user-pool JWT
            (raw compact JWT string, no "Bearer " prefix). This is the value the
            callee re-verifies against the user-pool JWKS.
        acting_agent: The id of the calling agent (the caller "acting on behalf
            of" the customer). Defaults to the account-opening agent.

    Returns:
        The metadata dict to attach to the outbound A2A message:
        ``{"identity_context": <jwt>, "acting_agent": <caller id>}``.

    Raises:
        ValueError: If ``customer_jwt`` is empty/blank or ``acting_agent`` is
            empty. Fail closed — an A2A request without a verified customer
            assertion must never be constructed.
    """
    if not customer_jwt or not customer_jwt.strip():
        raise ValueError("build_identity_context requires a non-empty customer JWT")
    if not acting_agent or not acting_agent.strip():
        raise ValueError("build_identity_context requires a non-empty acting_agent id")

    return {
        IDENTITY_CONTEXT_KEY: customer_jwt,
        ACTING_AGENT_KEY: acting_agent,
    }


def read_identity_context(message: Any) -> str | None:
    """Extract the forwarded customer identity assertion from an A2A message.

    Handles both dict-shaped messages (the JSON-RPC ``params.message`` body as
    it arrives over the wire) and object-shaped messages (a Strands ``Message``
    exposing a ``metadata`` attribute). The returned value is the raw JWT string
    to be verified by the callee; this function performs no verification.

    Args:
        message: The inbound A2A message, either a mapping with a ``metadata``
            entry or an object with a ``metadata`` attribute.

    Returns:
        The forwarded ``identity_context`` JWT string, or ``None`` if the
        message carries no metadata or no identity-context entry.
    """
    metadata = _get_field(message, "metadata")
    if metadata is None:
        return None

    assertion = _get_field(metadata, IDENTITY_CONTEXT_KEY)
    if assertion is None:
        return None

    return assertion if isinstance(assertion, str) else None


def read_acting_agent(message: Any) -> str | None:
    """Extract the acting-agent id from an inbound A2A message, if present."""
    metadata = _get_field(message, "metadata")
    if metadata is None:
        return None

    acting_agent = _get_field(metadata, ACTING_AGENT_KEY)
    return acting_agent if isinstance(acting_agent, str) else None


def _get_field(obj: Any, key: str) -> Any:
    """Read ``key`` from a mapping or an object attribute, tolerating either."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)
