"""Timebound AgentCore Gateway MCP client, shared by every Strands agent.

Every agent talks to the AgentCore Gateway over MCP streamable-HTTP. The default
client has NO per-tool-call deadline, and that is the single cause of the "stuck"
pipeline: a Gateway tool request whose result never streams back (the POST is
answered ``202 Accepted`` and the answer is meant to arrive on the SSE channel)
hangs the calling agent thread forever. The transport's ``sse_read_timeout`` does
not save us — it is reset by the Gateway's SSE keepalives, so it never fires — and
a thread blocked in a C-level socket read cannot be interrupted by the pipeline
watchdog. The run just goes silent (observed live: a 87-minute gap in the runtime
logs with no error, after a lone ``POST /mcp 202 Accepted``).

The reliable bound is a per-call ``read_timeout_seconds``. Strands' ``MCPAgentTool``
forwards its ``.timeout`` straight to ``ClientSession.call_tool`` as
``read_timeout_seconds``, which the MCP session enforces with ``anyio.fail_after``
inside its OWN event loop. That deadline fires regardless of SSE keepalives, and
Strands turns the resulting error into a normal tool-error result — so a wedged
Gateway call becomes "that one tool call failed, keep going" instead of an
unbounded hang.

This module imports Strands, so it must NOT be imported by the LiveKit worker
image (which does not install Strands). Use ``utils.gateway_tools`` for anything
that both transports share.
"""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient
from strands.tools.mcp.mcp_agent_tool import MCPAgentTool

# Hard per-call ceiling for any single Gateway tool invocation. Set well above
# the slowest legitimate tool (PDF render and Bedrock image generation both
# finish in well under a minute) so it never truncates real work, while still
# converting an indefinitely wedged call into a bounded, recoverable error.
DEFAULT_GATEWAY_TOOL_TIMEOUT = timedelta(seconds=240)


class TimeboundMCPClient(MCPClient):
    """``MCPClient`` that stamps a hard read timeout on every tool it lists.

    ``load_tools`` (the ToolProvider entry point Strands calls when an MCPClient
    is passed in ``tools=[...]``) delegates to ``list_tools_sync``, so overriding
    the latter is enough to reach every code path that hands tools to an agent.
    """

    def __init__(self, *args: Any, tool_timeout: timedelta, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._tool_timeout = tool_timeout

    def list_tools_sync(self, *args: Any, **kwargs: Any) -> Any:
        tools = super().list_tools_sync(*args, **kwargs)
        for tool in tools:
            if isinstance(tool, MCPAgentTool):
                tool.timeout = self._tool_timeout
        return tools


def create_gateway_mcp_client(
    gateway_url: str,
    access_token: str,
    *,
    prefix: str = "gateway",
    tool_filters: dict | None = None,
    tool_timeout: timedelta = DEFAULT_GATEWAY_TOOL_TIMEOUT,
    client_factory: Callable[..., Any] = TimeboundMCPClient,
) -> MCPClient:
    """Build a Gateway MCP client with a hard per-tool-call deadline.

    Args:
        gateway_url: AgentCore Gateway MCP endpoint (from SSM).
        access_token: OAuth2 bearer token for the Gateway.
        prefix: Tool-name prefix (``gateway`` everywhere in this codebase).
        tool_filters: Optional Strands tool filters (the planner narrows to
            ``kb_search`` only).
        tool_timeout: Per-call ceiling applied to every listed tool.
        client_factory: Seam for tests; defaults to ``TimeboundMCPClient``.
    """
    return client_factory(
        lambda: streamablehttp_client(
            url=gateway_url,
            headers={"Authorization": f"Bearer {access_token}"},
        ),
        prefix=prefix,
        tool_filters=tool_filters,
        tool_timeout=tool_timeout,
    )
