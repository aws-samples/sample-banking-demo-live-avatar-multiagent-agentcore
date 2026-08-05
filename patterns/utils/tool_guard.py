"""Force-inject verified user_id into MCP tool calls before dispatch.

Uses Strands SDK HookProvider + BeforeToolCallEvent so the runtime (not the LLM)
controls which user_id is sent to every user-scoped Gateway tool.
"""

import logging
from typing import Any

from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

logger = logging.getLogger(__name__)

# Separator the AgentCore Gateway puts between a target name and its tool name.
GATEWAY_NAME_SEPARATOR = "___"


def bare_tool_name(registered_name: str) -> str:
    """Reduce a registered tool name to the tool itself.

    A gateway tool reaches Strands as ``<prefix>_<target>___<tool>``, e.g.
    ``gateway_pdf-generator___pdf_generator`` — the target segment uses hyphens
    and the client prefix is prepended. Matching on the full string therefore
    never succeeded, and both hooks in this package returned early for every
    call: nothing was ever injected or filtered. Probed against the live gateway,
    all 17 registered names differ from the values previously listed here, so the
    exact-match set had zero overlap.

    Comparing only the trailing segment is stable against both the prefix and the
    target's own naming.
    """
    return registered_name.rsplit(GATEWAY_NAME_SEPARATOR, 1)[-1]


# Gateway tools that require the verified user_id, by bare tool name.
USER_SCOPED_TOOLS: frozenset[str] = frozenset(
    {
        "kb_search",
        "pdf_generator",
        "save_memory",
        "recall_memories",
        "analyze_patterns",
        "retrieve_user_profile",
        "nova_canvas_generate",
        "nova_canvas_edit",
        "nova_reel_generate",
        "place_order",
    }
)


class UserScopeHook(HookProvider):
    """Force-injects verified user_id into MCP tool calls before dispatch."""

    def __init__(self, user_id: str) -> None:
        self._user_id = user_id

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeToolCallEvent, self._inject_user_id)

    def _inject_user_id(self, event: BeforeToolCallEvent) -> None:
        tool_name = bare_tool_name(event.tool_use["name"])
        if tool_name not in USER_SCOPED_TOOLS:
            return

        tool_input: dict[str, Any] = event.tool_use["input"]

        original = tool_input.get("user_id")
        if original and original != self._user_id:
            logger.warning(
                "tool_guard: overriding LLM user_id=%s with verified %s for %s",
                original,
                self._user_id,
                tool_name,
            )

        tool_input["user_id"] = self._user_id
        logger.info("tool_guard: injected user_id=%s into %s", self._user_id, tool_name)
