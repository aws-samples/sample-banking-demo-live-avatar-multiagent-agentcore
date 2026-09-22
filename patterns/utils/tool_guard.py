"""Force-inject verified user_id into MCP tool calls before dispatch.

Uses Strands SDK HookProvider + the before-tool-call events so the runtime (not
the LLM) controls which user_id is sent to every user-scoped Gateway tool. See
utils.hook_events for why more than one event type is registered.
"""

import logging
from typing import Any

from strands.hooks import HookProvider, HookRegistry

from utils.gateway_tools import USER_SCOPED_TOOLS, bare_tool_name
from utils.hook_events import BEFORE_TOOL_CALL_EVENTS, BeforeToolCall

__all__ = [
    "FRAUD_RESEARCH_TOOL",
    "USER_SCOPED_TOOLS",
    "FraudIdentityHook",
    "UserScopeHook",
    "bare_tool_name",
]

logger = logging.getLogger(__name__)

# Bare name of the caller-side A2A fraud-hop tool exposed to the account-opening
# agent. The customer identity that crosses the hop is injected server-side, so
# these identity-bearing keys must never be taken from model-produced arguments.
FRAUD_RESEARCH_TOOL = "consult_fraud_research"
_IDENTITY_ARG_KEYS = ("user_id", "customer_jwt", "identity_context", "sub", "acting_agent")


class UserScopeHook(HookProvider):
    """Force-injects verified user_id into MCP tool calls before dispatch."""

    def __init__(self, user_id: str) -> None:
        self._user_id = user_id

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        for event_type in BEFORE_TOOL_CALL_EVENTS:
            registry.add_callback(event_type, self._inject_user_id)

    def _inject_user_id(self, event: BeforeToolCall) -> None:
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


class FraudIdentityHook(HookProvider):
    """Strip model-supplied identity args from the fraud A2A tool call.

    Mirrors :class:`UserScopeHook`: the runtime — not the LLM — controls the
    customer identity that crosses the A2A hop. The ``consult_fraud_research``
    tool closes over the verified customer identity captured server-side from the
    request JWT, so any identity-bearing key the model tries to pass in the tool
    input is removed here before dispatch. This makes "the propagated identity
    never comes from model arguments" an enforced, observable invariant rather
    than a convention.
    """

    def __init__(self, tool_name: str = FRAUD_RESEARCH_TOOL) -> None:
        self._tool_name = tool_name

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        for event_type in BEFORE_TOOL_CALL_EVENTS:
            registry.add_callback(event_type, self._scrub_identity_args)

    def _scrub_identity_args(self, event: BeforeToolCall) -> None:
        if bare_tool_name(event.tool_use["name"]) != self._tool_name:
            return

        tool_input: dict[str, Any] = event.tool_use["input"]
        for key in _IDENTITY_ARG_KEYS:
            if key in tool_input:
                logger.warning(
                    "tool_guard: stripping model-supplied %r from %s — identity is injected server-side",
                    key,
                    self._tool_name,
                )
                tool_input.pop(key, None)
