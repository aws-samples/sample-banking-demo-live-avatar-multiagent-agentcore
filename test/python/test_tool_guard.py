"""Tests for `patterns/utils/tool_guard.py::UserScopeHook`.

UserScopeHook is the runtime-side enforcement of per-user tenant isolation:
it overwrites `tool_input["user_id"]` with the verified value from the JWT.

These tests previously asserted the scoped set contained names like
`gateway_kb_search` and passed, while the hook injected nothing at all — the
names a gateway tool actually registers under are
`gateway_kb-search___kb_search`, so the membership check never matched. Asserting
the set's contents proved nothing about whether those contents match reality, so
the cases below drive the hook with realistic registered names.
"""

from __future__ import annotations

import pytest
from gateway_tools import bare_tool_name
from tool_guard import USER_SCOPED_TOOLS, UserScopeHook

# Names exactly as the gateway registers them, captured from the live gateway:
# "<client prefix>_<target with hyphens>___<tool with underscores>".
REGISTERED_SCOPED_TOOLS = (
    "gateway_kb-search___kb_search",
    "gateway_pdf-generator___pdf_generator",
    "gateway_save-memory___save_memory",
    "gateway_recall-memories___recall_memories",
    "gateway_analyze-patterns___analyze_patterns",
    "gateway_retrieve-user-profile___retrieve_user_profile",
    "gateway_image-generate___image_generate",
    "gateway_image-history___image_history",
    "gateway_place-order___place_order",
)

REGISTERED_UNSCOPED_TOOLS = (
    "gateway_web-search___web_search",
    "gateway_data-sources___data_sources",
)


def test_user_scoped_tools_covers_all_tenant_sensitive_tools():
    """Guard against forgetting to add a new user-scoped tool.

    Every gateway tool that reads or writes per-user data MUST be in this set.
    Adding a new one requires updating this list too. The test intentionally
    hard-codes the expected set so a forgotten entry is a loud test failure,
    not a silent leak.
    """
    expected = {
        "kb_search",
        "pdf_generator",
        "save_memory",
        "recall_memories",
        "analyze_patterns",
        "retrieve_user_profile",
        "image_generate",
        # The history tool reads per-user data and so belongs here. It used to
        # take a model-supplied session_id as its only key, which meant a
        # caller handing over someone else's id read their media.
        "image_history",
        "place_order",
    }
    assert set(USER_SCOPED_TOOLS) == expected


def test_registered_names_resolve_into_the_scoped_set():
    """The set has to match what the gateway actually calls these tools.

    This is the assertion whose absence let the hook sit inert: the set was
    self-consistent and simply described nothing that exists.
    """
    for registered in REGISTERED_SCOPED_TOOLS:
        assert bare_tool_name(registered) in USER_SCOPED_TOOLS, registered

    for registered in REGISTERED_UNSCOPED_TOOLS:
        assert bare_tool_name(registered) not in USER_SCOPED_TOOLS, registered


class TestUserScopeHookInjection:
    """The hook always overwrites user_id for every tool in USER_SCOPED_TOOLS."""

    @pytest.mark.parametrize("tool_name", REGISTERED_SCOPED_TOOLS)
    def test_inject_user_id_on_every_scoped_tool(self, make_event, tool_name):
        hook = UserScopeHook("alice")
        event = make_event(tool_name)
        hook._inject_user_id(event)
        assert event.tool_use["input"]["user_id"] == "alice"

    def test_llm_supplied_user_id_is_overwritten(self, make_event):
        # The whole point of the hook: the LLM cannot spoof another user.
        hook = UserScopeHook("alice")
        event = make_event("gateway_kb-search___kb_search", user_id="bob")
        hook._inject_user_id(event)
        assert event.tool_use["input"]["user_id"] == "alice"

    @pytest.mark.parametrize("tool_name", REGISTERED_UNSCOPED_TOOLS)
    def test_unscoped_tools_are_left_alone(self, make_event, tool_name):
        # Tools with no tenant dimension must not receive an injected user_id.
        hook = UserScopeHook("alice")
        event = make_event(tool_name)
        hook._inject_user_id(event)
        assert "user_id" not in event.tool_use["input"]


class TestPlaceOrderScoped:
    """place_order writes per-user data, so it must be scoped."""

    def test_place_order_is_user_scoped(self):
        assert bare_tool_name("gateway_place-order___place_order") in USER_SCOPED_TOOLS
