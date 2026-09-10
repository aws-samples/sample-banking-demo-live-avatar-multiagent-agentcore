"""
HTTP server for the deployed (cloud) Tavus video-avatar worker.

The Pipecat dev runner only knows how to create Daily/WebRTC/telephony rooms, so
it cannot drive `TavusTransport` (Tavus creates the room itself). This small
FastAPI app takes its place:

  - `GET  /health` — ALB target-group health check.
  - `POST /start`  — starts one avatar session and returns the Tavus room URL.

Flow: the offer Lambda POSTs `{"createDailyRoom": true, "body": {user_id,
persona, voiceId}}` (the `createDailyRoom` flag is ignored here). We start a
`run_session` task; `TavusTransport` creates the Tavus conversation, and its
`on_connected` resolves the room URL onto a future. We return
`{"room_url": "https://tavus.daily.co/<room>"}` to the browser, which joins that
room with daily-js. The session task keeps running in the background.

Authentication is enforced upstream by the Cognito-authorized offer Lambda, so
there is no token gate here.

Run:
    python server.py --host 0.0.0.0 --port 7860
"""

import argparse
import asyncio
import sys

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from loguru import logger
from tavus_pipecat_agent import _load_tavus_secret, _tavus_creds_present, run_session

# How long to wait for Tavus to create the conversation and the bot to connect
# before giving up on a /start. Must stay below the offer Lambda's read timeout.
START_TIMEOUT_SECONDS = 18.0

# Keep references to running session tasks so they are not garbage-collected
# mid-session (asyncio holds only weak references to bare tasks).
_sessions: set[asyncio.Task] = set()


async def health() -> dict:
    """ALB target-group health check."""
    return {"status": "ok"}


async def start(request: Request) -> JSONResponse:
    """Start one avatar session and return the Tavus room URL."""
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001 - tolerate empty/invalid bodies
        payload = {}

    # The offer Lambda nests the verified session data under "body"; accept a
    # bare body too for direct calls.
    body = payload.get("body") if isinstance(payload, dict) else None
    if not isinstance(body, dict):
        body = payload if isinstance(payload, dict) else {}

    if not _tavus_creds_present():
        logger.warning("[TAVUS] Credentials not configured — refusing /start")
        return JSONResponse({"error": "tavus_not_configured"}, status_code=503)

    loop = asyncio.get_running_loop()
    url_future: asyncio.Future = loop.create_future()
    task = asyncio.create_task(run_session(body, url_future))
    _sessions.add(task)
    task.add_done_callback(_sessions.discard)

    try:
        # Shield so a timeout here does not cancel the running session task.
        room_url = await asyncio.wait_for(asyncio.shield(url_future), timeout=START_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 - surface a clean error, cancel the session
        logger.exception("[TAVUS] Session failed to start: {}", exc)
        task.cancel()
        return JSONResponse({"error": "tavus_start_failed"}, status_code=502)

    return JSONResponse({"room_url": room_url})


def create_app() -> FastAPI:
    # Load Tavus credentials into the environment once at process startup, before
    # any request builds a transport.
    _load_tavus_secret()

    app = FastAPI()
    app.add_api_route("/health", health, methods=["GET"])
    app.add_api_route("/start", start, methods=["POST"])
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Tavus Pipecat worker server")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("-v", "--verbose", action="count", default=0)
    args = parser.parse_args()

    logger.remove()
    logger.add(sys.stderr, level="TRACE" if args.verbose else "INFO")

    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
