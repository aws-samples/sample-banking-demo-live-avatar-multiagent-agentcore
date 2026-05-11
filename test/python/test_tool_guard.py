"""Tests for `patterns/utils/tool_guard.py::UserScopeHook`.

UserScopeHook is the runtime-side enforcement of per-user tenant isolation:
it overwrites `tool_input["user_id"]` with the verified value from the JWT.
"""

from __future__ import annotations

import pytest
from tool_guard import USER_SCOPED_TOOLS, UserScopeHook


def test_user_scoped_tools_covers_all_tenant_sensitive_tools():
    """Guard against forgetting to add a new user-scoped tool.

    Every gateway tool that reads or writes per-user data MUST be in this set.
    Adding a new one requires updating this list too. The test intentionally
    hard-codes the expected set so a forgotten entry is a loud test failure,
    not a silent leak.
    """
    expected = {
        "gateway_kb_search",
        "gateway_pdf_generator",
        "gateway_save_memory",
        "gateway_recall_memories",
        "gateway_analyze_patterns",
        "gateway_retrieve_user_profile",
        "gateway_nova_canvas_generate",
        "gateway_nova_canvas_edit",
        "gateway_nova_reel_generate",
        "gateway_place_order",
    }
    assert set(USER_SCOPED_TOOLS) == expected


class TestUserScopeHookInjection:
    """The hook always overwrites user_id for every tool in USER_SCOPED_TOOLS."""

    @pytest.mark.parametrize("tool_name", sorted(USER_SCOPED_TOOLS))
    def test_inject_user_id_on_every_scoped_tool(self, make_event, tool_name):
        hook = UserScopeHook("alice")
        event = make_event(tool_name)
        hook._inject_user_id(event)
        assert event.tool_use["input"]["user_id"] == "alice"

    def test_llm_supplied_user_id_is_overwritten(self, make_event):
        # The whole point of the hook: the LLM cannot spoof another user.
        hook = UserScopeHook("alice")
        event = make_event("gateway_kb_search", user_id="bob")
        hook._inject_user_id(event)
        assert event.tool_use["input"]["user_id"] == "alice"

    def test_unscoped_tools_are_left_alone(self, make_event):
        # Tools not in USER_SCOPED_TOOLS must not receive an injected user_id.
        # `gateway_web_search` is a good example — it has no tenant dimension.
        hook = UserScopeHook("alice")
        event = make_event("gateway_web_search")
        hook._inject_user_id(event)
        assert "user_id" not in event.tool_use["input"]


class TestPlaceOrderScoped:
    """Task 8: place_order now requires user_id."""

    def test_place_order_is_user_scoped(self):
        assert "gateway_place_order" in USER_SCOPED_TOOLS
