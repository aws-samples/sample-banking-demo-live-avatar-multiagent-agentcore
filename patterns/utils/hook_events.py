"""The before-tool-call hook events to register for, across agent types.

Strands dispatches a different before-tool-call event depending on the agent:
a regular `Agent` receives `BeforeToolCallEvent`, while a `BidiAgent` (the voice
avatar) receives `BidiBeforeToolCallEvent`. A hook that registers only the first
is silently inert on the avatar — which is how the avatar's `kb_search` calls
reached the gateway with no injected `user_id` or `pipelines` and came back
refused as `caller-scope-required`.

The bidi event lives in the experimental namespace and was removed in
strands-agents 1.55.0, where BidiAgent moved back onto the unified
`BeforeToolCallEvent`. The avatar is pinned below 1.55.0, but these hooks are
shared with agents that allow newer releases, so the import is guarded and the
event list simply narrows to the unified event when the split is absent.
"""

from strands.hooks import BeforeToolCallEvent

try:
    from strands.experimental.hooks import BidiBeforeToolCallEvent
except ImportError:
    BEFORE_TOOL_CALL_EVENTS: tuple[type, ...] = (BeforeToolCallEvent,)
    BeforeToolCall = BeforeToolCallEvent
else:
    BEFORE_TOOL_CALL_EVENTS = (BeforeToolCallEvent, BidiBeforeToolCallEvent)
    BeforeToolCall = BeforeToolCallEvent | BidiBeforeToolCallEvent

__all__ = ["BEFORE_TOOL_CALL_EVENTS", "BeforeToolCall"]
