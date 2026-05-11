"""Tests for `gateway/tools/kb_search/handler.py::_build_filter`.

These cover the exact filter shapes the handler composes for Bedrock's
`vectorSearchConfiguration.filter`. Mirrors the nine cases in the handler's
`__main__` smoke test but asserts shapes programmatically.
"""

from __future__ import annotations

import json


class TestSanitizePipelines:
    """Input-side guard against bad values reaching Bedrock."""

    def test_known_values_pass_through(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._sanitize_pipelines(["menu"]) == ["menu"]

    def test_unknown_values_are_dropped(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._sanitize_pipelines(["bistro_research", "bogus"]) == ["bistro_research"]

    def test_duplicates_are_deduped(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._sanitize_pipelines(["menu", "menu", "open_research"]) == ["menu", "open_research"]

    def test_non_list_input_returns_empty(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._sanitize_pipelines("not-a-list") == []

    def test_empty_or_none_returns_empty(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._sanitize_pipelines([]) == []
        assert mod._sanitize_pipelines(None) == []


class TestBuildFilter:
    """Shape assertions for every user_id × pipelines permutation."""

    def test_no_scope_returns_none(self, load_tool):
        # Task 2 will change the kb_search HANDLER to fail closed when this
        # returns None. The filter builder itself is correct; the decision
        # lives in the caller path. Keep this as-is.
        mod = load_tool("kb_search")
        assert mod._build_filter("", []) is None

    def test_user_only(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._build_filter("alice", []) == {"equals": {"key": "user_id", "value": "alice"}}

    def test_single_pipeline_uses_equals(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._build_filter("", ["menu"]) == {"equals": {"key": "pipeline", "value": "menu"}}

    def test_multi_pipeline_uses_in(self, load_tool):
        mod = load_tool("kb_search")
        assert mod._build_filter("", ["bistro_research", "open_research"]) == {
            "in": {"key": "pipeline", "value": ["bistro_research", "open_research"]}
        }

    def test_user_plus_single_pipeline_uses_andAll(self, load_tool):
        mod = load_tool("kb_search")
        expected = {
            "andAll": [
                {"equals": {"key": "user_id", "value": "alice"}},
                {"equals": {"key": "pipeline", "value": "menu"}},
            ]
        }
        assert mod._build_filter("alice", ["menu"]) == expected

    def test_user_plus_multi_pipeline_uses_andAll_with_in(self, load_tool):
        mod = load_tool("kb_search")
        expected = {
            "andAll": [
                {"equals": {"key": "user_id", "value": "alice"}},
                {"in": {"key": "pipeline", "value": ["bistro_research", "menu"]}},
            ]
        }
        assert mod._build_filter("alice", ["bistro_research", "menu"]) == expected


class TestFailClosedScopeCheck:
    """Task 2 contract: kb_search must refuse to return unfiltered results
    unless explicitly allowed via archive_mode. The entrypoint handler runs
    this check before any Bedrock call."""

    def _ctx(self, lambda_context):
        return lambda_context("kb_search")

    def test_handler_returns_empty_when_no_scope_supplied(self, load_tool, lambda_context, monkeypatch):
        mod = load_tool("kb_search")
        monkeypatch.setenv("KNOWLEDGE_BASE_ID", "stub-kb-id")
        resp = mod.handler({"query": "test"}, self._ctx(lambda_context))
        body = json.loads(resp["content"][0]["text"])
        assert body["reason"] == "caller-scope-required"
        assert body["results"] == []
        assert body["result_count"] == 0

    def test_handler_refuses_user_id_only_without_archive_mode(self, load_tool, lambda_context, monkeypatch):
        mod = load_tool("kb_search")
        monkeypatch.setenv("KNOWLEDGE_BASE_ID", "stub-kb-id")
        resp = mod.handler(
            {"query": "test", "user_id": "alice"},
            self._ctx(lambda_context),
        )
        body = json.loads(resp["content"][0]["text"])
        # user_id without pipelines is only allowed in archive mode.
        assert body["reason"] == "caller-scope-required"

    def test_handler_refuses_pipelines_only_without_user_id(self, load_tool, lambda_context, monkeypatch):
        mod = load_tool("kb_search")
        monkeypatch.setenv("KNOWLEDGE_BASE_ID", "stub-kb-id")
        resp = mod.handler(
            {"query": "test", "pipelines": ["menu"]},
            self._ctx(lambda_context),
        )
        body = json.loads(resp["content"][0]["text"])
        # user_id is required unconditionally.
        assert body["reason"] == "caller-scope-required"
