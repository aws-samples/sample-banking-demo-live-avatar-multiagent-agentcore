"""Pure tenant-scoping logic for the Tavus/Pipecat gateway toolset.

Kept free of Pipecat imports so it can be unit-tested without the heavy
`pipecat-ai` dependency, and so the scoping contract lives in one obvious place.
This mirrors `patterns/livekit-agent`'s `_ScopedGatewayServer` intent: for a
user-scoped gateway tool, the runtime injects the verified caller `user_id` (and,
for `kb_search`, the caller's owned pipelines) OVER whatever the model supplied.
"""

from utils.gateway_tools import USER_SCOPED_TOOLS, bare_tool_name

# Every knowledge-base view the caller owns. kb_search filters by user_id
# independently, so this reads only this caller's own reports across sections
# without the archive view's fail-open semantics. Mirrors
# `_ScopedGatewayServer.ALL_PIPELINES`.
ALL_PIPELINES = ("strategy_research", "market_research", "services")


def is_user_scoped(tool_name: str) -> bool:
    """True when the tool (by full gateway name or bare name) is user-scoped."""
    return bare_tool_name(tool_name) in USER_SCOPED_TOOLS


def scope_for(tool_name: str, user_id: str) -> dict:
    """Return the runtime scope to merge over model-supplied arguments.

    - Non-scoped tools get an empty scope (nothing injected).
    - Scoped tools get `{"user_id": ...}`, plus `{"pipelines": [...]}` for
      `kb_search`.
    - This function does not decide fail-closed behaviour on an empty
      `user_id`; the toolset omits scoped tools entirely when there is no
      verified caller (see gateway_toolset.discover), which is the fail-closed
      point.
    """
    bare = bare_tool_name(tool_name)
    if bare not in USER_SCOPED_TOOLS:
        return {}
    scope: dict = {"user_id": user_id}
    if bare == "kb_search":
        scope["pipelines"] = list(ALL_PIPELINES)
    return scope


def merge_scope(model_args: dict | None, tool_name: str, user_id: str) -> dict:
    """Merge the runtime scope over model-supplied args — runtime always wins."""
    return {**(model_args or {}), **scope_for(tool_name, user_id)}
