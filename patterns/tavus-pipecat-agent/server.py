"""
Server wrapper around the Pipecat runner for the deployed (cloud) worker.

Adds a `/health` endpoint for the ALB target-group health check. Unlike the
reference `server.py`, there is no `DEMO_API_TOKEN` gate here: the offer endpoint
is reached only through the Cognito-authorized offer Lambda (which verifies the
caller and injects the verified `sub` into the offer body), so authentication is
enforced upstream rather than in the container.

Run:
    python server.py --transport daily --host 0.0.0.0 --port 7860
"""

import argparse
import sys

import uvicorn
from loguru import logger
from pipecat.runner.run import _configure_server_app
from pipecat.runner.run import app as pipecat_app


def create_app(args: argparse.Namespace):
    _configure_server_app(args)

    @pipecat_app.get("/health")
    async def health():  # noqa: ANN202
        return {"status": "ok"}

    return pipecat_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Tavus Pipecat worker server")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument(
        "-t",
        "--transport",
        type=str,
        choices=["daily", "webrtc"],
        default="daily",
    )
    parser.add_argument("-x", "--proxy", type=str, default=None)
    parser.add_argument("-v", "--verbose", action="count", default=0)
    parser.add_argument("--allowed-origins", nargs="*", default=None)
    args = parser.parse_args()

    logger.remove()
    logger.add(sys.stderr, level="TRACE" if args.verbose else "INFO")

    app = create_app(args)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
