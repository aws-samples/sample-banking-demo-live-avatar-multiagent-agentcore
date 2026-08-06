"""
Tavus video-avatar worker — Pipecat + Amazon Nova Sonic.

Real-time speech-to-speech over WebRTC. Amazon Nova Sonic
(`amazon.nova-2-sonic-v1:0`) on Bedrock stays the brain (STT + LLM + TTS in one
bidirectional stream); the AgentCore Gateway tools and per-caller tenant
isolation are preserved (see gateway_toolset.py). Tavus is added as a
render-only pipeline stage: it receives the model's response audio and returns a
lip-synced photoreal video track. Because the renderer is a single stage, another
vendor (HeyGen, etc.) can replace it without touching the model or tools.

Pipeline (Nova Sonic):

    transport.input()
      → context_aggregator.user()
      → UserTranscriptForwarder        (user STT → data channel)
      → llm (AWSNovaSonicLLMService)   ↔ Bedrock Nova Sonic
      → AgentTranscriptForwarder       (agent text → data channel)
      → TavusVideoService              (render stage)
      → transport.output()
      → context_aggregator.assistant()

Transport: SmallWebRTC locally, Daily in the cloud (selected by the runner).
Identity: the caller's verified Cognito `sub` arrives in the offer `body`
(injected server-side by the Cognito-authorized offer endpoint — the browser
never supplies its own `user_id`).
"""

import asyncio
import contextlib
import json
import os

import aiohttp
import boto3
from gateway_toolset import GatewayToolset
from loguru import logger
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from persona_prompts import get_persona_prompt
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.aws.nova_sonic.llm import AWSNovaSonicLLMService
from pipecat.services.tavus.video import TavusVideoService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.daily.transport import DailyParams
from transcript_forwarders import AgentTranscriptForwarder, UserTranscriptForwarder
from utils.auth import get_gateway_access_token, get_secret
from utils.ssm import get_ssm_parameter
from voice_replica import resolve_replica_id

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_PERSONA = os.environ.get("PERSONA", "friendly")
VOICE_ID = os.environ.get("VOICE_ID", "tiffany")
STACK_NAME = os.environ.get("STACK_NAME", "")
# Secrets Manager secret holding Tavus + Daily credentials. The task role reads
# it at startup (below) rather than having ECS inject individual fields, so the
# secret can be created out-of-band (before deploy) and its value never lives in
# CloudFormation. Defaults to the stack convention `/{stack}/tavus`.
TAVUS_SECRET_NAME = os.environ.get("TAVUS_SECRET_NAME", f"/{STACK_NAME}/tavus" if STACK_NAME else "")

# Keys expected inside the Tavus secret JSON.
_TAVUS_SECRET_KEYS = ("TAVUS_API_KEY", "TAVUS_REPLICA_ID", "TAVUS_PERSONA_ID", "DAILY_API_KEY")

# Seconds to wait for the Tavus replica to initialize before the greeting.
AVATAR_WARMUP_SECONDS = float(os.environ.get("AVATAR_WARMUP_SECONDS", "6"))
# Max session length / idle timeout, for cost control (Tavus bills per minute).
MAX_CALL_DURATION_SECONDS = int(os.environ.get("MAX_CALL_DURATION_SECONDS", "600"))
IDLE_TIMEOUT_SECONDS = int(os.environ.get("IDLE_TIMEOUT_SECONDS", "120"))

GREETING = (
    "Greet the user in one short sentence as the Trinity Reserve Bank "
    "relationship manager, then ask how you can help. Speak in English."
)

# Nova Sonic has built-in VAD + turn detection, so no external analyzers.
_video_params = dict(
    audio_in_enabled=True,
    audio_out_enabled=True,
    video_out_enabled=True,
    video_out_is_live=True,
    video_out_width=1280,
    video_out_height=720,
)
transport_params = {
    "daily": lambda: DailyParams(**_video_params),
    "webrtc": lambda: TransportParams(**_video_params),
}


def _load_tavus_secret() -> None:
    """Populate Tavus/Daily env vars from Secrets Manager if not already set.

    The task role reads the secret at startup rather than having ECS inject
    individual fields. This lets the secret be created out-of-band (before the
    stack is deployed), keeps its value out of CloudFormation, and mirrors how
    `utils.auth` fetches the gateway M2M secret.

    Env vars already present (e.g. passed with `docker run -e` for local dev)
    win, so local testing needs no Secrets Manager access at all. A missing or
    unreadable secret is non-fatal: the creds guard then refuses sessions
    cleanly and the container stays healthy.
    """
    if os.environ.get("TAVUS_API_KEY") and os.environ.get("TAVUS_REPLICA_ID"):
        return
    if not TAVUS_SECRET_NAME:
        return
    try:
        raw = get_secret(TAVUS_SECRET_NAME)
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 - non-fatal; guard refuses sessions
        logger.warning("[TAVUS] Could not load secret {}: {}", TAVUS_SECRET_NAME, exc)
        return
    for key in _TAVUS_SECRET_KEYS:
        value = data.get(key)
        if value and not os.environ.get(key):
            os.environ[key] = value


def _tavus_creds_present() -> bool:
    """True only when the Tavus render stage can be constructed.

    The `/{stack}/tavus` secret ships with empty placeholders until the operator
    populates it. Without this guard the worker would raise mid-session; instead
    a session refuses cleanly and the container stays healthy, mirroring the
    LiveKit worker's `_livekit_creds_present`.
    """
    return bool(os.environ.get("TAVUS_API_KEY") and os.environ.get("TAVUS_REPLICA_ID"))


def _resolve_identity(runner_args: RunnerArguments) -> tuple[str, str, str]:
    """Read the server-verified caller identity, persona, and voice from the offer.

    The Cognito-authorized offer endpoint injects `user_id` (the verified `sub`)
    and optional `persona`/`voiceId` into the offer `requestData`; the browser
    never supplies its own `user_id`. An empty `user_id` leaves scoped tools
    refusing (fail-closed), matching the LiveKit path. The voice defaults to the
    task's configured `VOICE_ID` when the caller sends none.
    """
    body = getattr(runner_args, "body", None) or {}
    if not isinstance(body, dict):
        return "", DEFAULT_PERSONA, VOICE_ID
    user_id = body.get("user_id", "") or ""
    persona = body.get("persona", DEFAULT_PERSONA) or DEFAULT_PERSONA
    voice_id = body.get("voiceId", "") or body.get("voice_id", "") or VOICE_ID
    return user_id, persona, voice_id


async def run_bot(transport, runner_args: RunnerArguments) -> None:
    user_id, persona, voice_id = _resolve_identity(runner_args)
    replica_id = resolve_replica_id(voice_id)
    logger.info(
        "[TAVUS] Session start: user_id={} persona={} voice={} replica={} model={} region={}",
        user_id or "<unknown>",
        persona,
        voice_id,
        replica_id or "<none>",
        MODEL_ID,
        REGION,
    )

    system_prompt = get_persona_prompt(persona)

    async with aiohttp.ClientSession() as http, contextlib.AsyncExitStack() as stack:
        tavus = TavusVideoService(
            api_key=os.environ["TAVUS_API_KEY"],
            replica_id=replica_id,
            persona_id=os.environ.get("TAVUS_PERSONA_ID", "pipecat-stream"),
            session=http,
        )

        # The AgentCore Gateway is OPTIONAL. If it is unreachable — local dev
        # with no deployed gateway, a missing SSM param, or a transient outage —
        # the worker continues with no tools so the avatar still converses. The
        # MCP session (when present) is kept open for the whole run via the exit
        # stack. Tenant isolation is unaffected: scoped tools are only ever
        # registered when a verified user_id AND a live gateway both exist.
        toolset: GatewayToolset | None = None
        gateway_schemas = []
        try:
            gateway_url = get_ssm_parameter(f"/{STACK_NAME}/gateway_url")
            access_token = get_gateway_access_token()
            read, write, _ = await stack.enter_async_context(
                streamablehttp_client(gateway_url, headers={"Authorization": f"Bearer {access_token}"})
            )
            mcp_session = await stack.enter_async_context(ClientSession(read, write))
            await mcp_session.initialize()
            toolset = GatewayToolset(mcp_session, user_id)
            gateway_schemas = await toolset.discover()
        except Exception as exc:  # noqa: BLE001 - degrade to a tool-less conversation
            logger.warning("[TAVUS] Gateway unavailable — continuing without tools: {}", exc)
            toolset = None
            gateway_schemas = []

        # Always a ToolsSchema (possibly empty) — Nova Sonic accepts an empty
        # tool set and simply converses without tool calls.
        tools = ToolsSchema(standard_tools=gateway_schemas)

        # AWSNovaSonicLLMService requires explicit AWS credentials (it does not
        # use the boto3 default chain). Prefer env vars; fall back to the frozen
        # credentials from the default chain (e.g. the Fargate task role).
        ak = os.environ.get("AWS_ACCESS_KEY_ID")
        sk = os.environ.get("AWS_SECRET_ACCESS_KEY")
        st = os.environ.get("AWS_SESSION_TOKEN")
        if not ak or not sk:
            frozen = boto3.Session().get_credentials().get_frozen_credentials()
            ak, sk, st = frozen.access_key, frozen.secret_key, frozen.token

        # Nova Sonic needs the tool *schemas* at construction; the tool
        # *handlers* are registered after the task exists (below), since they
        # publish tool activity through it.
        llm = AWSNovaSonicLLMService(
            access_key_id=ak,
            secret_access_key=sk,
            session_token=st,
            region=REGION,
            model=MODEL_ID,
            voice_id=voice_id,
            system_instruction=system_prompt,
            tools=tools,
        )

        messages = [{"role": "system", "content": system_prompt}]
        context = LLMContext(messages, tools=tools)
        context_aggregator = LLMContextAggregatorPair(context)

        user_transcript = UserTranscriptForwarder()
        agent_transcript = AgentTranscriptForwarder(accumulate=False)

        # Nova Sonic pushes user TranscriptionFrame UPSTREAM, so
        # user_transcript sits between the LLM and the aggregator.
        pipeline = Pipeline(
            [
                transport.input(),
                context_aggregator.user(),
                user_transcript,
                llm,
                agent_transcript,
                tavus,
                transport.output(),
                context_aggregator.assistant(),
            ]
        )

        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                audio_in_sample_rate=16000,
                audio_out_sample_rate=24000,
                enable_metrics=True,
                enable_usage_metrics=True,
            ),
            idle_timeout_secs=IDLE_TIMEOUT_SECONDS,
        )
        # Register scoped tool handlers now that the task exists (handlers
        # publish tool activity through it). Only when the gateway is live.
        if toolset is not None:
            toolset.register(llm, task, is_nova_sonic=True)

        started = {"done": False}

        async def start_conversation(label: str) -> None:
            if started["done"]:
                return
            started["done"] = True
            logger.info("[TAVUS] {}: warming up avatar…", label)
            await asyncio.sleep(AVATAR_WARMUP_SECONDS)
            messages.append({"role": "system", "content": f"Greet the user with: {GREETING}"})
            await task.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_first_participant_joined")
        async def _on_first(transport, participant):  # noqa: ANN001
            await start_conversation("participant joined")

        @transport.event_handler("on_client_connected")
        async def _on_connected(transport, client):  # noqa: ANN001
            await start_conversation("client connected")

        @transport.event_handler("on_client_disconnected")
        async def _on_disconnected(transport, client):  # noqa: ANN001
            logger.info("[TAVUS] client disconnected — cancelling task")
            await task.cancel()

        runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)
        await runner.run(task)


async def bot(runner_args: RunnerArguments) -> None:
    """Pipecat runner entry point (one call per WebRTC session)."""
    _load_tavus_secret()
    if not _tavus_creds_present():
        logger.warning(
            "[TAVUS] Tavus credentials not configured (empty secret). Refusing "
            "session — populate /{}/tavus and restart.",
            STACK_NAME or "<stack>",
        )
        return
    params = transport_params
    transport = await create_transport(runner_args, params)
    await run_bot(transport, runner_args)


if __name__ == "__main__":
    # Local dev entry point (SmallWebRTC). The deployed container runs server.py,
    # which adds the ALB health check around the same runner app.
    from pipecat.runner.run import main

    main()
