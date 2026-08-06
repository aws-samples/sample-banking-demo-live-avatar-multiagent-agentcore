"""Tests for the Tavus worker's voice-id → replica-id resolution.

Locks in the demo contract: the female voice `tiffany` renders Gloria and the
male voice `matthew` renders Raj, while any unmapped voice falls back to the
single `TAVUS_REPLICA_ID` from the secret so a face still renders.

Targets `patterns/tavus-pipecat-agent/voice_replica.py`, which is deliberately
free of Pipecat imports so it can be tested without the heavy `pipecat-ai`
dependency (mirroring scope.py).
"""

from __future__ import annotations

from voice_replica import replica_by_voice, resolve_replica_id

GLORIA = "r3f427f43c9d"
RAJ = "rf8f3aa4b33e"
MAP_JSON = f'{{"tiffany": "{GLORIA}", "matthew": "{RAJ}"}}'


class TestReplicaByVoice:
    def test_parses_map(self):
        assert replica_by_voice(MAP_JSON) == {"tiffany": GLORIA, "matthew": RAJ}

    def test_empty_string_is_empty_map(self):
        assert replica_by_voice("") == {}

    def test_invalid_json_is_empty_map(self):
        assert replica_by_voice("{not json") == {}

    def test_non_object_json_is_empty_map(self):
        assert replica_by_voice('["tiffany"]') == {}

    def test_drops_empty_values(self):
        assert replica_by_voice('{"tiffany": "", "matthew": "' + RAJ + '"}') == {"matthew": RAJ}


class TestResolveReplicaId:
    def test_tiffany_maps_to_gloria(self, monkeypatch):
        monkeypatch.setenv("TAVUS_REPLICA_BY_VOICE", MAP_JSON)
        monkeypatch.setenv("TAVUS_REPLICA_ID", GLORIA)
        assert resolve_replica_id("tiffany") == GLORIA

    def test_matthew_maps_to_raj(self, monkeypatch):
        monkeypatch.setenv("TAVUS_REPLICA_BY_VOICE", MAP_JSON)
        monkeypatch.setenv("TAVUS_REPLICA_ID", GLORIA)
        assert resolve_replica_id("matthew") == RAJ

    def test_unmapped_voice_falls_back_to_secret_default(self, monkeypatch):
        monkeypatch.setenv("TAVUS_REPLICA_BY_VOICE", MAP_JSON)
        monkeypatch.setenv("TAVUS_REPLICA_ID", GLORIA)
        # A voice with no entry (e.g. a Spanish voice) still renders a face.
        assert resolve_replica_id("lupe") == GLORIA

    def test_no_map_uses_secret_default(self, monkeypatch):
        monkeypatch.delenv("TAVUS_REPLICA_BY_VOICE", raising=False)
        monkeypatch.setenv("TAVUS_REPLICA_ID", GLORIA)
        assert resolve_replica_id("matthew") == GLORIA

    def test_explicit_default_overrides_env(self, monkeypatch):
        monkeypatch.setenv("TAVUS_REPLICA_BY_VOICE", MAP_JSON)
        assert resolve_replica_id("unknown", default="fallback-id") == "fallback-id"
