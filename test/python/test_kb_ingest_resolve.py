"""Tests for `gateway/tools/kb_ingest/handler.py`.

Fail-closed contract (see docs/kb-isolation.md):
  * Unknown pipeline tags + unknown prefixes MUST raise, not silently tag
    as "unknown".
  * Missing user_id metadata MUST raise — historically we silently wrote
    sidecars without user_id, leaking docs across tenants.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _stub_ingest_env(monkeypatch):
    """Module-level env reads happen at import; stub them so the load
    succeeds without requiring a deploy."""
    monkeypatch.setenv("KB_DOCS_BUCKET", "stub-kb-docs")
    monkeypatch.setenv("KNOWLEDGE_BASE_ID", "stub-kb-id")
    monkeypatch.setenv("DATA_SOURCE_ID", "stub-ds-id")
    yield


class TestResolvePipelineHappyPath:
    """Known metadata tag + known prefix both resolve to the canonical value."""

    def test_explicit_bistro_research_metadata(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("reports/foo.pdf", {"pipeline": "bistro_research"}) == "bistro_research"

    def test_explicit_open_research_metadata(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("reports/foo.pdf", {"pipeline": "open_research"}) == "open_research"

    def test_explicit_menu_metadata(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("menus/foo.pdf", {"pipeline": "menu"}) == "menu"

    def test_legacy_research_alias_maps_to_bistro(self, load_tool):
        # Legacy callers of pdf_generator wrote pipeline="research" before the
        # taxonomy was split. The alias keeps them on bistro_research.
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("reports/foo.pdf", {"pipeline": "research"}) == "bistro_research"

    def test_reports_prefix_fallback(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("reports/foo.pdf", {}) == "bistro_research"

    def test_menus_prefix_fallback(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("menus/foo.pdf", {}) == "menu"

    def test_none_metadata_treated_as_empty(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("reports/foo.pdf", None) == "bistro_research"

    def test_bogus_metadata_falls_back_to_known_prefix(self, load_tool):
        # If a producer sets a garbage `pipeline` metadata value but the
        # key prefix is recognized, the prefix wins. Keeps us tolerant of
        # transient producer bugs as long as the key layout is sane.
        mod = load_tool("kb_ingest")
        assert mod._resolve_pipeline("reports/foo.pdf", {"pipeline": "bogus"}) == "bistro_research"


class TestResolvePipelineFailClosed:
    """Unknown prefix + unrecognized metadata → hard reject.

    Previously these fell through to `pipeline=unknown`, which produced docs
    that failed every filter but could leak via archive_chat's unfiltered
    path. Refuse at ingest instead.
    """

    def test_unknown_prefix_raises(self, load_tool):
        mod = load_tool("kb_ingest")
        with pytest.raises(mod.PipelineResolutionError):
            mod._resolve_pipeline("other/foo.pdf", {})

    def test_unknown_prefix_with_bogus_metadata_raises(self, load_tool):
        mod = load_tool("kb_ingest")
        with pytest.raises(mod.PipelineResolutionError):
            mod._resolve_pipeline("misc/foo.pdf", {"pipeline": "bogus"})


class TestRequireUserId:
    """The handler refuses to write sidecars without a user_id metadata value.

    That metadata value is the ONLY tenant-isolation signal in S3 Vectors'
    view of the doc — without it, the doc passes every filter and leaks
    across tenants.
    """

    def test_missing_user_id_raises(self, load_tool):
        mod = load_tool("kb_ingest")
        with pytest.raises(ValueError):
            mod._require_user_id({"pipeline": "bistro_research"})

    def test_empty_user_id_raises(self, load_tool):
        mod = load_tool("kb_ingest")
        with pytest.raises(ValueError):
            mod._require_user_id({"user_id": "", "pipeline": "bistro_research"})

    def test_whitespace_only_user_id_raises(self, load_tool):
        mod = load_tool("kb_ingest")
        with pytest.raises(ValueError):
            mod._require_user_id({"user_id": "   "})

    def test_none_metadata_raises(self, load_tool):
        mod = load_tool("kb_ingest")
        with pytest.raises(ValueError):
            mod._require_user_id(None)

    def test_valid_user_id_returned_trimmed(self, load_tool):
        mod = load_tool("kb_ingest")
        assert mod._require_user_id({"user_id": "  alice  "}) == "alice"
