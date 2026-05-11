"""Tests for `patterns/utils/auth.py::extract_user_id_from_token`.

This is the shared helper used by both the HTTP/SSE orchestrator (via
extract_user_id_from_context) and the WebSocket avatar (directly from the
id_token query param). A bug here is a tenant-isolation breach, so the
tests live with the rest of the isolation harness.
"""

from __future__ import annotations

import base64
import json

import pytest
from auth import extract_user_id_from_token


def _make_jwt(payload: dict, alg: str = "RS256") -> str:
    """Build an unsigned JWT with the given payload.

    Signature is intentionally garbage — the helper under test explicitly
    skips signature verification (upstream auth already validated the token
    before it reached us). Using an unsigned token in tests keeps the
    dependency surface tiny.
    """

    def _b64(obj: dict | bytes) -> str:
        if isinstance(obj, dict):
            obj = json.dumps(obj).encode()
        return base64.urlsafe_b64encode(obj).rstrip(b"=").decode()

    header = _b64({"alg": alg, "typ": "JWT"})
    body = _b64(payload)
    sig = _b64(b"unused-signature")
    return f"{header}.{body}.{sig}"


class TestExtractUserIdHappyPath:
    def test_extracts_sub_claim(self):
        token = _make_jwt({"sub": "abc-123", "email": "alice@example.com"})
        assert extract_user_id_from_token(token) == "abc-123"

    def test_handles_other_claims(self):
        token = _make_jwt({"sub": "user-42", "aud": "client-id", "iss": "cognito"})
        assert extract_user_id_from_token(token) == "user-42"


class TestExtractUserIdFailClosed:
    def test_empty_string_raises(self):
        with pytest.raises(ValueError):
            extract_user_id_from_token("")

    def test_malformed_token_raises(self):
        with pytest.raises(ValueError):
            extract_user_id_from_token("not-a-jwt")

    def test_missing_sub_claim_raises(self):
        token = _make_jwt({"email": "alice@example.com"})
        with pytest.raises(ValueError):
            extract_user_id_from_token(token)

    def test_empty_sub_claim_raises(self):
        token = _make_jwt({"sub": ""})
        with pytest.raises(ValueError):
            extract_user_id_from_token(token)
