"""
SSE heartbeat wrapper for AgentCore Runtime agents.

AgentCore's proxy infrastructure drops chunked HTTP connections after ~80 seconds
of inactivity. When agents pause to wait for Bedrock model responses or Gateway
tool calls, the SSE stream goes silent and the connection gets killed with:

    RemoteProtocolError: peer closed connection without sending complete message
    body (incomplete chunked read)

This module provides a wrapper that interleaves periodic heartbeat events into
an async generator stream, keeping the connection alive during long processing gaps.
"""

import asyncio
from typing import AsyncGenerator

_SENTINEL = object()

# Heartbeat event marker — orchestrator and frontend should skip these
HEARTBEAT_EVENT = {"heartbeat": True}


async def _next_or_sentinel(aiter) -> object:
    """Fetch next item from async iterator, returning sentinel on exhaustion.

    Wraps StopAsyncIteration to avoid RuntimeError when used inside
    asyncio.ensure_future (PEP 479).
    """
    try:
        return await aiter.__anext__()
    except StopAsyncIteration:
        return _SENTINEL


async def with_heartbeat(stream: AsyncGenerator, interval: float = 15.0) -> AsyncGenerator:
    """Wrap an async generator with periodic heartbeat events.

    Emits ``{"heartbeat": True}`` if no real event arrives within *interval*
    seconds.  The orchestrator filters these out so they never reach the
    frontend.

    Args:
        stream: The async generator to wrap (e.g. ``agent.stream_async(...)``).
        interval: Seconds between heartbeats during idle periods.  Default 15s
            is well under AgentCore's ~80s proxy timeout.

    Yields:
        Events from the wrapped stream, interleaved with heartbeat dicts.
    """
    aiter = stream.__aiter__()
    while True:
        task = asyncio.ensure_future(_next_or_sentinel(aiter))
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=interval)
            if not done:
                # Stream is idle — emit keepalive to prevent proxy timeout
                yield HEARTBEAT_EVENT
        result = task.result()
        if result is _SENTINEL:
            break
        yield result
