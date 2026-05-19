"""Tests for the sessionStart-based auth path in the avatar WebSocket handler.

Regression harness for the fix that moved id_token extraction out of the
WebSocket URL query string (which AgentCore Runtime's proxy drops) and
into the first `sessionStart` JSON message. The handler must:

1. Accept the socket first (pre-accept close cannot send code 4401).
2. Read the first JSON message.
3. Extract `idToken` from sessionStart and call `extract_user_id_from_token`.
4. On missing/invalid token: send an error frame and close with code 4401.
5. On valid token: construct the agent with `user_id = sub claim`.

We drive the handler directly with a fake WebSocket rather than standing
up a real uvicorn / AgentCore runtime.
"""

from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

_AVATAR_AGENT_PATH = Path(__file__).resolve().parents[2] / "patterns" / "avatar-agent" / "avatar_agent.py"


def _make_jwt(payload: dict) -> str:
    """Build an unsigned JWT — the helper under test skips signature
    verification because upstream auth already validated the token."""

    def _b64(obj: dict | bytes) -> str:
        if isinstance(obj, dict):
            obj = json.dumps(obj).encode()
        return base64.urlsafe_b64encode(obj).rstrip(b"=").decode()

    return f"{_b64({'alg': 'RS256', 'typ': 'JWT'})}.{_b64(payload)}.{_b64(b'unused-sig')}"


@pytest.fixture(autouse=True)
def _stub_avatar_env(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("BEDROCK_REGION", "us-east-1")
    monkeypatch.setenv("STACK_NAME", "stub-stack")
    yield


@pytest.fixture
def avatar_module():
    module_name = "_test_avatar_agent_session_auth"
    if module_name in sys.modules:
        del sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, _AVATAR_AGENT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class FakeWebSocket:
    """Minimal FastAPI WebSocket stand-in.

    Tracks the order of accept / receive / send / close so tests can assert
    the handler accepts the socket before any JSON read (required to send
    a custom close code) and closes with code 4401 when auth fails.
    """

    def __init__(self, incoming: list[dict[str, Any]], query_params: dict[str, str] | None = None):
        self._incoming = list(incoming)
        self.query_params = query_params or {}
        self.accepted = False
        self.sent: list[dict[str, Any]] = []
        self.closed_with: tuple[int, str] | None = None
        self.events: list[str] = []  # ordered event log

    async def accept(self) -> None:
        self.accepted = True
        self.events.append("accept")

    async def receive_json(self) -> dict[str, Any]:
        self.events.append("receive_json")
        if not self._incoming:
            # Simulate client disconnect rather than hanging forever.
            raise RuntimeError("FakeWebSocket: no more incoming messages")
        return self._incoming.pop(0)

    async def send_json(self, data: dict[str, Any]) -> None:
        self.events.append(f"send:{data.get('type')}")
        self.sent.append(data)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.events.append(f"close:{code}")
        # Only record the FIRST close — real WebSockets treat subsequent
        # close() calls as no-ops, and the handler's `finally` block always
        # invokes close() with defaults, which would otherwise overwrite
        # our 4401 record.
        if self.closed_with is None:
            self.closed_with = (code, reason)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class TestSessionStartAuthFailure:
    """Missing / invalid idToken must close with 4401 AFTER accept."""

    def test_missing_id_token_closes_4401(self, avatar_module, monkeypatch):
        # Patch out Gateway/agent creation so we never get that far on the
        # failure path — if the handler leaks past the auth check, these
        # fakes would still keep the test deterministic.
        monkeypatch.setattr(avatar_module, "get_gateway_access_token", lambda: pytest.fail("must not reach gateway"))
        monkeypatch.setattr(
            avatar_module,
            "create_gateway_mcp_client",
            lambda _t: pytest.fail("must not reach gateway"),
        )
        monkeypatch.setattr(
            avatar_module,
            "create_avatar_agent",
            lambda **_: pytest.fail("must not reach agent creation"),
        )

        ws = FakeWebSocket(
            incoming=[{"type": "sessionStart", "sessionId": "s1"}]  # no idToken
        )

        _run(avatar_module.websocket_handler(ws))

        # Accept must come before close so the 4401 frame is actually sent.
        assert ws.accepted is True
        assert ws.events.index("accept") < ws.events.index("close:4401")
        assert ws.closed_with == (4401, "invalid_id_token")
        # An error frame should have been sent to the client.
        assert any(m.get("type") == "error" for m in ws.sent)

    def test_malformed_id_token_closes_4401(self, avatar_module, monkeypatch):
        monkeypatch.setattr(
            avatar_module,
            "create_avatar_agent",
            lambda **_: pytest.fail("must not reach agent creation"),
        )

        ws = FakeWebSocket(incoming=[{"type": "sessionStart", "sessionId": "s1", "idToken": "not-a-jwt"}])

        _run(avatar_module.websocket_handler(ws))

        assert ws.accepted is True
        assert ws.closed_with == (4401, "invalid_id_token")


class TestSessionStartAuthSuccess:
    """Valid idToken must reach create_avatar_agent with the verified sub."""

    def test_valid_token_creates_agent_with_sub(self, avatar_module, monkeypatch):
        captured: dict[str, Any] = {}

        class _FakeAgent:
            async def run(self, **_kwargs):
                # Return immediately so the handler exits cleanly without
                # trying to pump audio from the fake socket.
                return None

        def _fake_create_agent(**kwargs):
            captured.update(kwargs)
            return _FakeAgent(), "system-prompt"

        monkeypatch.setattr(avatar_module, "get_gateway_access_token", lambda: "fake-access-token")
        monkeypatch.setattr(avatar_module, "create_gateway_mcp_client", lambda _t: object())
        monkeypatch.setattr(avatar_module, "create_avatar_agent", _fake_create_agent)

        token = _make_jwt({"sub": "test-user"})
        ws = FakeWebSocket(incoming=[{"type": "sessionStart", "sessionId": "s1", "idToken": token}])

        _run(avatar_module.websocket_handler(ws))

        assert ws.accepted is True
        # No 4401 close.
        assert ws.closed_with is None or ws.closed_with[0] != 4401
        assert captured.get("user_id") == "test-user"
