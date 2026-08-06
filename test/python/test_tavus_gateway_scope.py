"""Tests for the Tavus/Pipecat worker's tenant-scoping logic.

Locks in the same contract the LiveKit worker enforces via
`_ScopedGatewayServer`: for a user-scoped gateway tool, the runtime injects the
verified caller `user_id` (and, for `kb_search`, the caller's pipelines) OVER
whatever the model supplied. A model-chosen `user_id` must never reach the
gateway.

These target `patterns/tavus-pipecat-agent/scope.py`, which is deliberately free
of Pipecat imports so it can be tested without the heavy `pipecat-ai` dependency.
"""

from __future__ import annotations

from scope import ALL_PIPELINES, is_user_scoped, merge_scope, scope_for

# Names exactly as the gateway registers them (target___tool), matching
# gateway_tools.bare_tool_name handling.
KB_SEARCH_TOOL = "gateway_kb-search___kb_search"
PDF_GENERATOR_TOOL = "gateway_pdf-generator___pdf_generator"
WEB_SEARCH_TOOL = "gateway_web-search___web_search"  # not user-scoped

USER_ID = "cognito-sub-1234"


class TestIsUserScoped:
    def test_kb_search_is_scoped(self):
        assert is_user_scoped(KB_SEARCH_TOOL) is True

    def test_pdf_generator_is_scoped(self):
        assert is_user_scoped(PDF_GENERATOR_TOOL) is True

    def test_web_search_is_not_scoped(self):
        assert is_user_scoped(WEB_SEARCH_TOOL) is False


class TestScopeFor:
    def test_kb_search_injects_user_and_all_pipelines(self):
        scope = scope_for(KB_SEARCH_TOOL, USER_ID)
        assert scope["user_id"] == USER_ID
        assert scope["pipelines"] == list(ALL_PIPELINES)

    def test_pdf_generator_injects_only_user(self):
        scope = scope_for(PDF_GENERATOR_TOOL, USER_ID)
        assert scope == {"user_id": USER_ID}

    def test_non_scoped_tool_gets_empty_scope(self):
        assert scope_for(WEB_SEARCH_TOOL, USER_ID) == {}


class TestMergeScope:
    def test_runtime_user_id_overrides_model_supplied(self):
        # A model that tries to set someone else's user_id must be overridden.
        merged = merge_scope({"user_id": "attacker", "query": "hi"}, KB_SEARCH_TOOL, USER_ID)
        assert merged["user_id"] == USER_ID
        assert merged["query"] == "hi"

    def test_runtime_pipelines_override_model_supplied(self):
        merged = merge_scope({"pipelines": ["services"]}, KB_SEARCH_TOOL, USER_ID)
        assert merged["pipelines"] == list(ALL_PIPELINES)

    def test_non_scoped_tool_passes_model_args_through(self):
        merged = merge_scope({"query": "aws"}, WEB_SEARCH_TOOL, USER_ID)
        assert merged == {"query": "aws"}

    def test_none_model_args_is_safe(self):
        merged = merge_scope(None, PDF_GENERATOR_TOOL, USER_ID)
        assert merged == {"user_id": USER_ID}


class TestFailClosedByOmission:
    """With no verified user_id, the toolset omits scoped tools entirely (the
    fail-closed point is `GatewayToolset.discover`, which skips them). scope_for
    itself is only ever called for tools that were registered, so an empty
    user_id would produce an empty user_id scope — but that path is unreachable
    for scoped tools because they are never registered. This test documents that
    the scope value for an empty user_id is still explicit (never silently
    absent), so a regression that started registering scoped tools without a
    caller would inject an empty user_id the gateway rejects, not omit it."""

    def test_empty_user_id_still_sets_user_id_key(self):
        scope = scope_for(KB_SEARCH_TOOL, "")
        assert scope["user_id"] == ""
        assert "pipelines" in scope
