"""Voice-id → Tavus replica-id resolution.

Kept free of Pipecat imports — like scope.py — so the mapping and, importantly,
its fallback can be unit-tested without the heavy `pipecat-ai` stack.

The caller's chosen Nova Sonic voice selects a matching avatar face: the female
voice `tiffany` → Gloria, the male voice `matthew` → Raj. Replica ids are
non-sensitive Tavus resource identifiers, so the map is supplied by cdk.json
context via the `TAVUS_REPLICA_BY_VOICE` env var (JSON). Any voice not in the map
falls back to the single `TAVUS_REPLICA_ID` from the secret, so an unmapped voice
still renders a face rather than failing.
"""

from __future__ import annotations

import json
import os


def replica_by_voice(raw: str | None = None) -> dict[str, str]:
    """Parse the voice → replica map. Empty or invalid JSON yields an empty map."""
    if raw is None:
        raw = os.environ.get("TAVUS_REPLICA_BY_VOICE", "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items() if v}


def resolve_replica_id(voice_id: str, default: str | None = None) -> str:
    """Replica for a voice, falling back to the secret's default replica id."""
    if default is None:
        default = os.environ.get("TAVUS_REPLICA_ID", "")
    return replica_by_voice().get(voice_id) or default
