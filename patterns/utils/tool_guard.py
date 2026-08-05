"""Force-inject verified user_id into MCP tool calls before dispatch.

Uses Strands SDK HookProvider + BeforeToolCallEvent so the runtime (not the LLM)
controls which user_id is sent to every user-scoped Gateway tool.
"""

import logging
from typing import Any

from strands.hooks import BeforeToolCallEvent, HookProvider, HookRegistry

from utils.gateway_tools import USER_SCOPED_TOOLS, bare_tool_name

__all__ = ["USER_SCOPED_TOOLS", "UserScopeHook", "bare_tool_name"]

logger = logging.getLogger(__name__)


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
