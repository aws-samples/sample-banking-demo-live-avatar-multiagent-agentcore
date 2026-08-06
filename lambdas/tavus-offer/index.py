"""
Cognito-authorized offer proxy for the Tavus/Pipecat video-avatar worker.

Fronted by API Gateway with a Cognito User Pools authorizer, so the caller's JWT
is already verified by the time we run. We read the `sub` claim from
`requestContext.authorizer.claims` and inject it into the offer forwarded to the
worker — the browser never supplies its own `user_id`, which is what keeps
per-caller tenant isolation trustworthy (the worker scopes gateway tools to this
injected identity; see patterns/tavus-pipecat-agent/gateway_toolset.py).

Flow:
  browser (Cognito JWT)  ── POST /tavus-offer {requestData?} ──▶  this Lambda
  this Lambda            ── POST {WORKER_CONNECT_URL} {..., requestData:{user_id, persona}} ──▶  worker (internal ALB)
  worker                 ──▶ Daily room URL + short-lived token (or SDP answer)
  this Lambda            ──▶ browser (worker response verbatim)

Only an ephemeral Daily room token reaches the browser; the DAILY_API_KEY and
TAVUS_API_KEY stay in the worker's task environment.
"""

import json
import logging
import os
import urllib.error
import urllib.request

logger = logging.getLogger()
logger.setLevel(logging.INFO)

WORKER_CONNECT_URL = os.environ.get("WORKER_CONNECT_URL", "")
CORS_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS", "*")
DEFAULT_PERSONA = os.environ.get("DEFAULT_PERSONA", "friendly")
CONNECT_TIMEOUT_SECONDS = float(os.environ.get("CONNECT_TIMEOUT_SECONDS", "20"))


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": CORS_ORIGINS,
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Content-Type": "application/json",
    }


def _response(status: int, body: dict) -> dict:
    return {"statusCode": status, "headers": _cors_headers(), "body": json.dumps(body)}


def _claims(event: dict) -> dict:
    if not isinstance(event, dict):
        return {}
    return event.get("requestContext", {}).get("authorizer", {}).get("claims", {}) or {}


def handler(event, _context):
    try:
        sub = _claims(event).get("sub")
        if not sub:
            logger.warning("No sub claim on request — authorizer misconfigured?")
            return _response(401, {"error": "unauthorized"})

        if not WORKER_CONNECT_URL:
            logger.error("WORKER_CONNECT_URL not configured")
            return _response(503, {"error": "worker_not_configured"})

        # The browser may send optional client request data (e.g. a persona
        # preference). Whatever it sends, we set user_id to the verified sub —
        # a client-supplied user_id must never win.
        try:
            client_body = json.loads(event.get("body") or "{}")
        except (TypeError, ValueError):
            client_body = {}
        if not isinstance(client_body, dict):
            client_body = {}

        client_request = client_body.get("requestData")
        if not isinstance(client_request, dict):
            client_request = {}
        session_body = {
            **client_request,
            "user_id": sub,
            "persona": client_request.get("persona", client_body.get("persona", DEFAULT_PERSONA)),
        }

        # Pipecat's Daily runner expects `/start` with a `createDailyRoom` flag
        # and the per-session data under `body`. It returns {dailyRoom, dailyToken}.
        worker_payload = {"createDailyRoom": True, "body": session_body}
        payload = json.dumps(worker_payload).encode("utf-8")
        req = urllib.request.Request(  # noqa: S310 - constant CDK-controlled internal URL
            WORKER_CONNECT_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        logger.info("Forwarding offer for sub=%s to worker", sub)
        with urllib.request.urlopen(req, timeout=CONNECT_TIMEOUT_SECONDS) as resp:  # noqa: S310
            worker_body = resp.read().decode("utf-8")
            status = resp.getcode() or 200

        try:
            parsed = json.loads(worker_body)
        except (TypeError, ValueError):
            parsed = {"raw": worker_body}
        return _response(status, parsed)

    except urllib.error.URLError as exc:
        logger.exception("Worker connect failed: %s", exc)
        return _response(502, {"error": "worker_unreachable"})
    except Exception as exc:  # noqa: BLE001 — surface a clean 500 to the browser
        logger.exception("Offer proxy failed: %s", exc)
        return _response(500, {"error": "offer_failed"})
