"""AgentCore Browser tools for the chatbot agent.

Provides Strands @tool functions that drive a cloud-sandboxed Chrome browser
(AgentCore Browser) via Playwright over CDP. One session is cached per chat
turn in module-level state and emits a live view URL to the frontend the first
time browser_start is called so the user can watch the agent work.

Usage pattern (called by the LLM):
    1. browser_start()                   -> starts session + emits BrowserLiveView UI
    2. browser_navigate(url=...)         -> go to the page
    3. browser_get_text()                -> read page so the LLM can decide next action
    4. browser_type(selector=..., text=...)
    5. browser_click(selector=...)
    6. browser_press_key(key="Enter")
    7. browser_stop()                    -> clean up
"""

from __future__ import annotations

import asyncio
import os
import queue
import threading
from typing import Any, Optional

from bedrock_agentcore.tools.browser_client import BrowserClient
from playwright.async_api import Page, async_playwright
from strands import tool

# ─── Session state (one active session per container) ─────────────────────────
# The orchestrator runtime is single-session-per-turn (AgentCore routes each
# InvokeAgent call to a dedicated container), so a module-level singleton is
# safe. The event loop that drives Playwright lives in its own thread since
# Strands tools run synchronously from the agent's perspective.

_REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")

_state: dict[str, Any] = {
    "client": None,  # BrowserClient
    "session_id": None,  # str
    "live_view_url": None,  # str
    "playwright": None,  # AsyncPlaywright cm
    "browser": None,  # Browser
    "page": None,  # Page
    "loop": None,  # asyncio.AbstractEventLoop running in worker thread
    "thread": None,  # threading.Thread
}

# Bridge for emitting UI events from tools into the orchestrator SSE queue.
# orchestrator_agent.py sets this before each chatbot turn.
_ui_queue: Optional[queue.Queue] = None


def set_ui_queue(q: Optional[queue.Queue]) -> None:
    """Called by the orchestrator to wire up the SSE event bridge."""
    global _ui_queue
    _ui_queue = q


def _emit_ui(component: str, props: dict) -> None:
    if _ui_queue is not None:
        _ui_queue.put(("ui", {"component": component, "props": props}))


# ─── Event-loop worker thread ─────────────────────────────────────────────────
# Playwright's async API needs an event loop. We run one in a dedicated thread
# so sync @tool handlers can submit coroutines via run_coroutine_threadsafe.


def _ensure_loop() -> asyncio.AbstractEventLoop:
    if _state["loop"] and _state["loop"].is_running():
        return _state["loop"]

    loop = asyncio.new_event_loop()

    def _run() -> None:
        asyncio.set_event_loop(loop)
        loop.run_forever()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    _state["loop"] = loop
    _state["thread"] = t
    return loop


def _run_async(coro) -> Any:
    loop = _ensure_loop()
    return asyncio.run_coroutine_threadsafe(coro, loop).result(timeout=120)


# ─── Tools ────────────────────────────────────────────────────────────────────


@tool
def browser_start() -> str:
    """Start a new AgentCore cloud browser session and attach Playwright.

    Emits a live view URL to the UI so the user can watch every action.
    Call this ONCE at the beginning of a browser task. Returns confirmation.
    """
    if _state["session_id"]:
        return f"Browser already running (session {_state['session_id']})."

    client = BrowserClient(_REGION)
    client.start(
        identifier="aws.browser.v1",
        name="concierge",
        session_timeout_seconds=900,
        viewport={"width": 1280, "height": 800},
    )

    ws_url, headers = client.generate_ws_headers()
    live_view_url = client.generate_live_view_url(expires=300)

    async def _attach() -> None:
        pw = await async_playwright().start()
        browser = await pw.chromium.connect_over_cdp(ws_url, headers=headers)

        # Wait for the remote Chrome's default context to be exposed over CDP.
        for _ in range(30):
            if browser.contexts:
                break
            await asyncio.sleep(0.1)

        if not browser.contexts:
            raise RuntimeError("AgentCore Browser did not expose a CDP context within 3s")

        # Canonical AgentCore pattern (per AWS docs + internal samples):
        # attach to the default context but ALWAYS create a fresh page. The
        # default pages[0] is a setup/blank tab the DCV live view does NOT
        # follow when Playwright navigates it — the live view stays pinned
        # to the originally visible tab (google.com). Creating a new page
        # via context.new_page() gives us a tab the display actually shows,
        # and bring_to_front() makes it the active one.
        context = browser.contexts[0]
        page = await context.new_page()
        await page.bring_to_front()
        _state["playwright"] = pw
        _state["browser"] = browser
        _state["page"] = page

    _run_async(_attach())

    _state["client"] = client
    _state["session_id"] = client.session_id
    _state["live_view_url"] = live_view_url

    _emit_ui(
        "BrowserLiveView",
        {
            "liveViewUrl": live_view_url,
            "sessionId": client.session_id,
            "remoteWidth": 1280,
            "remoteHeight": 800,
        },
    )

    return "Browser session started. Live view is now streaming to the user."


@tool
def browser_navigate(url: str) -> str:
    """Navigate the browser to a URL. Start a session first with browser_start."""
    page: Page = _state.get("page")
    if not page:
        return "Error: no active browser session. Call browser_start first."

    async def _go() -> str:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        return await page.title()

    try:
        title = _run_async(_go())
        return f"Navigated to {url} — page title: {title}"
    except Exception as e:
        return f"Navigation failed: {e}"


@tool
def browser_click(selector: str) -> str:
    """Click an element by CSS selector."""
    page: Page = _state.get("page")
    if not page:
        return "Error: no active browser session."

    async def _click() -> None:
        await page.click(selector, timeout=10000)

    try:
        _run_async(_click())
        return f"Clicked: {selector}"
    except Exception as e:
        return f"Click failed: {e}"


@tool
def browser_type(selector: str, text: str) -> str:
    """Type text into an input element by CSS selector."""
    page: Page = _state.get("page")
    if not page:
        return "Error: no active browser session."

    async def _type() -> None:
        await page.fill(selector, text, timeout=10000)

    try:
        _run_async(_type())
        return f'Typed "{text}" into {selector}'
    except Exception as e:
        return f"Type failed: {e}"


@tool
def browser_get_text(selector: str = "") -> str:
    """Get visible text from the page (or from a specific element if selector given).

    Prefer calling with no selector to read the full page — the LLM can then
    reason over the raw text. Truncates at 4000 chars to protect context.
    """
    page: Page = _state.get("page")
    if not page:
        return "Error: no active browser session."

    async def _get() -> str:
        if selector:
            return await page.inner_text(selector, timeout=10000)
        return await page.inner_text("body", timeout=10000)

    try:
        text = _run_async(_get())
        if len(text) > 4000:
            return text[:4000] + "\n... [truncated]"
        return text
    except Exception as e:
        return f"Get text failed: {e}"


@tool
def browser_press_key(key: str) -> str:
    """Press a keyboard key (e.g. "Enter", "Tab")."""
    page: Page = _state.get("page")
    if not page:
        return "Error: no active browser session."

    async def _press() -> None:
        await page.keyboard.press(key)

    try:
        _run_async(_press())
        return f"Pressed: {key}"
    except Exception as e:
        return f"Press key failed: {e}"


@tool
def browser_stop() -> str:
    """Stop the browser session and release resources."""
    if not _state["session_id"]:
        return "No active browser session."

    async def _close() -> None:
        if _state["browser"]:
            await _state["browser"].close()
        if _state["playwright"]:
            await _state["playwright"].stop()

    try:
        _run_async(_close())
    except Exception:
        pass

    try:
        _state["client"].stop()
    except Exception:
        pass

    session_id = _state["session_id"]
    _state.update(
        {
            "client": None,
            "session_id": None,
            "live_view_url": None,
            "playwright": None,
            "browser": None,
            "page": None,
        }
    )
    return f"Stopped browser session {session_id}."


def cleanup() -> None:
    """Best-effort cleanup called at the end of a chat turn."""
    if _state["session_id"]:
        try:
            browser_stop()
        except Exception:
            pass


BROWSER_TOOLS = [
    browser_start,
    browser_navigate,
    browser_click,
    browser_type,
    browser_get_text,
    browser_press_key,
    browser_stop,
]
