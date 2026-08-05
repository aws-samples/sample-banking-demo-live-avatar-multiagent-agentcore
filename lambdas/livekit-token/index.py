"""
Mint a LiveKit access token scoped to the caller's verified Cognito identity.

Fronted by API Gateway with a Cognito User Pools authorizer, so the caller's
JWT is already verified by the time we run — we read the `sub` claim from
`requestContext.authorizer.claims` and never trust a client-supplied identity.

The token grants join access to a fresh room per connection, named
`trb-<sub>-<nonce>`. The LiveKit agent worker auto-dispatches into the room and
bridges Nova Sonic 2 audio.

The nonce is what makes the agent show up. LiveKit's automatic dispatch fires
when a room is *created*, not when a participant joins. The room used to be
`trb-<sub>`, stable for the life of the user, which meant a room outliving its
session permanently broke that user: every later connect joined the existing
room, no creation event fired, no agent was dispatched, and the caller sat in a
room with nobody in it. That is exactly what happened — a room created at
00:08 UTC was still listed four hours later holding a participant LiveKit had
never reaped, so every reconnect after it was silent.

A per-connection room removes the whole class of failure: a stale room can no
longer poison the next session, reconnecting cannot evict a previous
same-identity participant, and abandoned rooms fall away on their own via the
server's empty-room timeout. The `sub` stays in the name so rooms remain
attributable to a user in logs, and tenant scoping is unaffected either way —
the worker reads the verified identity from the participant, not the room name.

Response: {"serverUrl": "...", "token": "...", "roomName": "..."} so the
browser needs only this one endpoint (no separate LiveKit URL env var).
"""

import json
import logging
import os
import re
import secrets

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


def _room_name(sub: str) -> str:
    """A fresh room per connection, still attributable to the caller.

    LiveKit room names allow a restricted charset, so the `sub` is sanitised.
    The trailing nonce guarantees the room is new, which is what triggers
    automatic agent dispatch — see the module docstring.
    """
    safe_sub = re.sub(r"[^a-zA-Z0-9_-]", "-", sub)[:100]
    return f"trb-{safe_sub}-{secrets.token_hex(4)}"


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

        room = _room_name(sub)
        logger.info("Minted LiveKit token for room %s", room)
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
