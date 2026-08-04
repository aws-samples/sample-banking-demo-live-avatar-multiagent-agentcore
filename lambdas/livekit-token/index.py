"""
Mint a LiveKit access token scoped to the caller's verified Cognito identity.

Fronted by API Gateway with a Cognito User Pools authorizer, so the caller's
JWT is already verified by the time we run — we read the `sub` claim from
`requestContext.authorizer.claims` and never trust a client-supplied identity.

The token grants join access to a per-user room (`trb-<sub>`). The LiveKit
agent worker auto-dispatches into the room and bridges Nova Sonic 2 audio.

Response: {"serverUrl": "...", "token": "...", "roomName": "..."} so the
browser needs only this one endpoint (no separate LiveKit URL env var).
"""

import json
import logging
import os
import re

import boto3
from livekit import api

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_secrets = boto3.client("secretsmanager")
_LIVEKIT: dict[str, str] | None = None

CORS_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "*")


def _load_livekit_creds() -> dict[str, str]:
    """Fetch + cache the LiveKit Cloud credentials from Secrets Manager."""
    global _LIVEKIT
    if _LIVEKIT is None:
        arn = os.environ["LIVEKIT_SECRET_ARN"]
        raw = _secrets.get_secret_value(SecretId=arn)["SecretString"]
        _LIVEKIT = json.loads(raw)
    return _LIVEKIT


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": CORS_ORIGINS,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Content-Type": "application/json",
    }


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": _cors_headers(), "body": json.dumps(body)}


def _sanitize_room(sub: str) -> str:
    """LiveKit room names allow a restricted charset; keep it safe."""
    return "trb-" + re.sub(r"[^a-zA-Z0-9_-]", "-", sub)[:100]


def handler(event, _context):
    try:
        claims = (
            event.get("requestContext", {}).get("authorizer", {}).get("claims", {}) if isinstance(event, dict) else {}
        )
        sub = claims.get("sub")
        if not sub:
            logger.warning("No sub claim on request — authorizer misconfigured?")
            return _response(401, {"error": "unauthorized"})

        creds = _load_livekit_creds()
        server_url = creds.get("url", "")
        api_key = creds.get("api_key", "")
        api_secret = creds.get("api_secret", "")
        if not (server_url and api_key and api_secret):
            logger.error("LiveKit secret not populated — set /<stack>/livekit values.")
            return _response(503, {"error": "livekit_not_configured"})

        room = _sanitize_room(sub)
        token = (
            api.AccessToken(api_key, api_secret)
            .with_identity(sub)
            .with_name(sub)
            .with_grants(api.VideoGrants(room_join=True, room=room))
            .to_jwt()
        )

        return _response(200, {"serverUrl": server_url, "token": token, "roomName": room})

    except Exception as exc:  # noqa: BLE001 — surface a clean 500 to the browser
        logger.exception("Failed to mint LiveKit token: %s", exc)
        return _response(500, {"error": "token_mint_failed"})
