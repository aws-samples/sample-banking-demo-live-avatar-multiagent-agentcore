"""Published agent-card metadata for the Trinity Fraud & Research Agent (A2A callee).

Single source of truth for the identity and capability fields the fraud-research
runtime advertises at ``/.well-known/agent-card.json``. ``serve_a2a`` / the
Strands ``A2AServer`` derive most of the card from the served agent, but the
advertised skill set and identity fields are declared here so the caller-side
contract (``patterns/utils/a2a_client.py``) and the callee never drift.

Advertising **exactly one** skill (``fraud_research_assessment``) is also the
mechanism by which unknown-capability requests are rejected: a request naming
any other skill/method has no advertised capability to match, so the handler
rejects it (Req 6.4).
"""

from __future__ import annotations

from typing import Any

# ─── Identity fields (Req 2.2) ───────────────────────────────────────────────

AGENT_NAME = "Trinity Fraud & Research Agent"
AGENT_DESCRIPTION = (
    "Fraud and research assessment for account-opening KYC over synthetic "
    "applicant data. Runs research tools only; performs no external calls and "
    "no account or PII writes."
)
AGENT_VERSION = "1.0.0"

# A2A transport contract for this runtime (Req 2.2, 2.4).
PREFERRED_TRANSPORT = "JSONRPC"
DEFAULT_INPUT_MODES: tuple[str, ...] = ("text",)
DEFAULT_OUTPUT_MODES: tuple[str, ...] = ("text",)

# ─── Advertised skill (Req 2.2, 6.4) ─────────────────────────────────────────

FRAUD_RESEARCH_SKILL_ID = "fraud_research_assessment"

FRAUD_RESEARCH_SKILL: dict[str, Any] = {
    "id": FRAUD_RESEARCH_SKILL_ID,
    "name": "Fraud & Research Assessment",
    "description": "Assess a synthetic account-opening applicant for fraud/research signals.",
    "tags": ["fraud", "kyc", "research"],
}

# The complete set of advertised skills. Exactly one skill is advertised; any
# other requested skill/method is unknown and must be rejected by the handler
# (Req 6.4).
ADVERTISED_SKILLS: tuple[dict[str, Any], ...] = (FRAUD_RESEARCH_SKILL,)


def build_agent_card(url: str) -> dict[str, Any]:
    """Build the wire-shaped agent-card document for a given invocation URL.

    Args:
        url: The runtime invocation URL the card advertises as its endpoint.

    Returns:
        The camelCase agent-card dict served at ``/.well-known/agent-card.json``.
    """
    return {
        "name": AGENT_NAME,
        "description": AGENT_DESCRIPTION,
        "version": AGENT_VERSION,
        "url": url,
        "preferredTransport": PREFERRED_TRANSPORT,
        "capabilities": {"streaming": True},
        "defaultInputModes": list(DEFAULT_INPUT_MODES),
        "defaultOutputModes": list(DEFAULT_OUTPUT_MODES),
        "skills": [dict(skill) for skill in ADVERTISED_SKILLS],
    }


def build_agent_skills() -> list[Any]:
    """Build the A2A ``AgentSkill`` objects for ``A2AServer(skills=...)``.

    Imported lazily so this module stays importable — and lint/compile clean —
    without the optional A2A extras (``strands-agents[a2a]``) installed. The
    server handler (Task 6) passes the result to the A2A server so the published
    card advertises exactly the ``fraud_research_assessment`` skill.
    """
    from a2a.types import AgentSkill  # noqa: PLC0415 — deferred optional A2A dependency

    return [
        AgentSkill(
            id=FRAUD_RESEARCH_SKILL_ID,
            name=FRAUD_RESEARCH_SKILL["name"],
            description=FRAUD_RESEARCH_SKILL["description"],
            tags=list(FRAUD_RESEARCH_SKILL["tags"]),
        )
    ]
