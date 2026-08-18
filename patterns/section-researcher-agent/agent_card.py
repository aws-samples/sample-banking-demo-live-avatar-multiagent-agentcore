"""Published agent-card metadata for the Trinity Section Researcher (A2A callee).

Single source of truth for the identity and capability fields the
section-researcher runtime advertises at ``/.well-known/agent-card.json``.
Mirrors the fraud agent's card module (task 5/10) so the caller-side contract
(``patterns/utils/a2a_client.py``) and the callee never drift.

Advertising **exactly one** skill (``section_research``) is also how
unknown-capability requests are rejected: a request naming any other
skill/method has no advertised capability to match, so the handler rejects it.
"""

from __future__ import annotations

from typing import Any

# ─── Identity fields ──────────────────────────────────────────────────────────

AGENT_NAME = "Trinity Section Researcher"
AGENT_DESCRIPTION = (
    "Parallel deep-research section worker over synthetic data. Researches one "
    "shard of a research plan's sub-questions using research tools only and "
    "returns the researcher JSON document consumed by the orchestrator's merge."
)
AGENT_VERSION = "1.0.0"

# A2A transport contract for this runtime.
PREFERRED_TRANSPORT = "JSONRPC"
DEFAULT_INPUT_MODES: tuple[str, ...] = ("text",)
DEFAULT_OUTPUT_MODES: tuple[str, ...] = ("text",)

# ─── Advertised skill ─────────────────────────────────────────────────────────

SECTION_RESEARCH_SKILL_ID = "section_research"

SECTION_RESEARCH_SKILL: dict[str, Any] = {
    "id": SECTION_RESEARCH_SKILL_ID,
    "name": "Section Research",
    "description": "Research one shard of a research plan's sub-questions over synthetic data.",
    "tags": ["research", "web", "kb"],
}

# The complete set of advertised skills. Exactly one skill is advertised; any
# other requested skill/method is unknown and must be rejected by the handler.
ADVERTISED_SKILLS: tuple[dict[str, Any], ...] = (SECTION_RESEARCH_SKILL,)


def build_agent_card(url: str) -> dict[str, Any]:
    """Build the wire-shaped agent-card document for a given invocation URL."""
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
    without the optional A2A extras (``strands-agents[a2a]``) installed.
    """
    from a2a.types import AgentSkill  # noqa: PLC0415 — deferred optional A2A dependency

    return [
        AgentSkill(
            id=SECTION_RESEARCH_SKILL_ID,
            name=SECTION_RESEARCH_SKILL["name"],
            description=SECTION_RESEARCH_SKILL["description"],
            tags=list(SECTION_RESEARCH_SKILL["tags"]),
        )
    ]
