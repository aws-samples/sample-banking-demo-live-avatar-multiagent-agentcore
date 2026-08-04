"""
LiveKit voice agent worker — Trinity Reserve Bank Relationship Manager.

Real-time speech-to-speech over WebRTC using LiveKit Agents + the AWS realtime
plugin (Amazon Nova Sonic 2, `amazon.nova-2-sonic-v1:0`). This worker replaces
the AgentCore-Runtime avatar (`patterns/avatar-agent/avatar_agent.py`) as the
voice backend when the `livekit` feature flag is enabled.

Architecture (shape A — ECS Fargate):
- A LiveKit media server (self-hosted, Fargate) proxies WebRTC audio between
  the browser and this worker.
- This worker is a long-lived Fargate service registered with the LiveKit
  server. For each room a browser joins, LiveKit dispatches `entrypoint()`.
- The worker bridges the room audio to Nova Sonic 2 and exposes the AgentCore
  Gateway tools over MCP (streamable HTTP) with a fresh M2M bearer token.

Credentials: the Fargate task role supplies AWS creds via the boto3 default
chain (used by the AWS realtime plugin for Bedrock and by `utils.auth` for
SSM / Secrets Manager). No static keys.

TENANT-ISOLATION NOTE (Phase 2):
The AgentCore avatar injected the verified Cognito `sub` (user_id) and the KB
pipeline scope into every gateway tool call via Strands `BeforeToolCallEvent`
hooks (UserScopeHook / PipelineScopeHook). LiveKit's MCP path does NOT run
those hooks, so per-user scoping is not yet enforced here. The verified
identity is available on the room participant (set by the token Lambda from
the Cognito `sub`); Phase 2 wraps the scoped tools as LiveKit `@function_tool`s
that inject `user_id` + `pipelines` server-side, restoring the isolation
contract documented in `docs/kb-isolation.md`. Until then this path is
single-tenant-safe only.
"""

import logging
import os

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, mcp
from livekit.plugins import aws
from persona_prompts import get_persona_prompt
from utils.auth import get_gateway_access_token
from utils.ssm import get_ssm_parameter

logger = logging.getLogger("livekit-agent")
logging.basicConfig(
    level=os.environ.get("LOGLEVEL", "INFO").upper(),
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_PERSONA = os.environ.get("PERSONA", "friendly")
# Nova Sonic voice id. This worker holds one voice for the life of the task:
# LiveKit rooms are joined before the client sends any preference, and the token
# endpoint carries no voice, so per-session switching is not available on this
# transport. Set via VOICE_ID (cdk.json -> context.livekit.voiceId).
VOICE_ID = os.environ.get("VOICE_ID", "tiffany")

# First-turn greeting. Nova Sonic is speech-to-speech; we prompt an opening line
# so the user hears the Relationship Manager without having to speak first.
GREETING_INSTRUCTIONS = (
    "Greet the user in one short sentence as the Trinity Reserve Bank relationship "
    "manager, then ask how you can help. Speak in English."
)


def _build_gateway_toolset() -> mcp.MCPToolset:
    """Build the AgentCore Gateway MCP toolset with a fresh M2M bearer token.

    Mirrors `avatar_agent.create_gateway_mcp_client`: the gateway URL comes from
    SSM (`/{STACK_NAME}/gateway_url`) and the token from the Cognito
    client-credentials flow (`utils.auth.get_gateway_access_token`). The token
    is valid ~1h; it is fetched per worker job so each conversation starts with
    a fresh token. Sessions longer than the token lifetime are out of scope for
    the demo.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    access_token = get_gateway_access_token()
    logger.info("[LIVEKIT] Gateway MCP toolset — url=%s token=%s...", gateway_url, access_token[:12])

    return mcp.MCPToolset(
        id="gateway",
        mcp_server=mcp.MCPServerHTTP(
            gateway_url,
            headers={"Authorization": f"Bearer {access_token}"},
            transport_type="streamable_http",
        ),
    )


def _resolve_user_id(ctx: JobContext) -> str:
    """Best-effort read of the verified caller identity from the room.

    The token Lambda sets the LiveKit participant `identity` to the Cognito
    `sub`, so the first remote participant's identity is the authenticated
    user. Returns an empty string if not yet available (the worker still runs;
    see the tenant-isolation note in the module docstring).
    """
    try:
        for participant in ctx.room.remote_participants.values():
            if participant.identity:
                return participant.identity
    except Exception:
        logger.warning("[LIVEKIT] Could not resolve participant identity", exc_info=True)
    return ""


async def entrypoint(ctx: JobContext) -> None:
    """LiveKit dispatches this once per room a browser joins."""
    await ctx.connect()

    user_id = _resolve_user_id(ctx)
    persona = os.environ.get("PERSONA", DEFAULT_PERSONA)
    logger.info(
        "[LIVEKIT] Session start: room=%s user_id=%s persona=%s model=%s region=%s",
        ctx.room.name,
        user_id or "<unknown>",
        persona,
        MODEL_ID,
        REGION,
    )

    system_prompt = get_persona_prompt(persona)

    session = AgentSession(
        # Without an explicit voice the plugin leaves it NOT_GIVEN and Nova Sonic
        # picks its own default, which is female. That made the UI voice selector
        # look broken on this transport: the dropdown only reaches the WebSocket
        # avatar runtime, never this worker.
        llm=aws.realtime.RealtimeModel(voice=VOICE_ID),
        tools=[_build_gateway_toolset()],
    )

    await session.start(
        room=ctx.room,
        agent=Agent(instructions=system_prompt),
    )

    await session.generate_reply(instructions=GREETING_INSTRUCTIONS)


def _livekit_creds_present() -> bool:
    """True only when all three LiveKit Cloud values are set.

    On first deploy the `/{stack}/livekit` secret ships with empty
    placeholders (the operator populates it post-deploy). Without this guard
    the worker would fail to connect and crash-loop, tripping the ECS
    deployment circuit breaker so the service never stabilizes. Instead we
    idle (keeping the container healthy) until the secret is populated and the
    service is restarted.
    """
    return bool(
        os.environ.get("LIVEKIT_URL") and os.environ.get("LIVEKIT_API_KEY") and os.environ.get("LIVEKIT_API_SECRET")
    )


if __name__ == "__main__":
    import sys

    _cmd = sys.argv[1] if len(sys.argv) > 1 else ""

    # Only guard the runtime `start` command. Build-time subcommands like
    # `download-files` must run and exit normally, so they bypass the guard.
    if _cmd == "start" and not _livekit_creds_present():
        import time

        logger.warning(
            "[LIVEKIT] Credentials not configured (empty secret). Idling — "
            "populate /%s/livekit and restart this service to connect.",
            os.environ.get("STACK_NAME", "<stack>"),
        )
        while True:
            time.sleep(60)

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
