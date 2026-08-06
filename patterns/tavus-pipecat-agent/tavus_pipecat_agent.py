"""
Tavus video-avatar worker — Pipecat + Amazon Nova Sonic (Tavus-hosted room).

Real-time speech-to-speech over WebRTC. Amazon Nova Sonic
(`amazon.nova-2-sonic-v1:0`) on Bedrock is the brain (STT + LLM + TTS in one
bidirectional stream); the AgentCore Gateway tools and per-caller tenant
isolation are preserved (see gateway_toolset.py).

Transport: `TavusTransport`. Tavus creates the room on **its own** Daily account
and returns a `conversation_url` (`https://tavus.daily.co/<room>`); the bot and
the Tavus avatar join it, and the browser joins the same URL. This needs only the
Tavus API key — no separate Daily account/key — which is the key difference from
the reference app (it created its own Daily room and therefore required a
`DAILY_API_KEY`). The renderer stays swappable: HeyGen, Simli and LemonSlice all
ship equivalent Pipecat transports.

Pipeline (Nova Sonic):

    transport.input()
      → context_aggregator.user()
      → UserTranscriptForwarder        (user STT → data channel)
      → llm (AWSNovaSonicLLMService)   ↔ Bedrock Nova Sonic
      → AgentTranscriptForwarder       (agent text → data channel)
      → transport.output()             → Tavus renders the audio as lip-synced video
      → context_aggregator.assistant()

Identity: the caller's verified Cognito `sub` arrives in the session `body`
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
from pipecat.services.aws.nova_sonic.llm import AWSNovaSonicLLMService
from pipecat.transports.tavus.transport import TavusParams, TavusTransport
from transcript_forwarders import AgentTranscriptForwarder, UserTranscriptForwarder
from utils.auth import get_gateway_access_token, get_secret
from utils.ssm import get_ssm_parameter
from voice_replica import resolve_replica_id

REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_PERSONA = os.environ.get("PERSONA", "friendly")
VOICE_ID = os.environ.get("VOICE_ID", "tiffany")
STACK_NAME = os.environ.get("STACK_NAME", "")
# Secrets Manager secret holding the Tavus credentials. The task role reads it at
# startup (see server.create_app) rather than having ECS inject individual
# fields, so the secret can be created out-of-band and its value never lives in
# CloudFormation. Defaults to the stack convention `/{stack}/tavus`.
TAVUS_SECRET_NAME = os.environ.get("TAVUS_SECRET_NAME", f"/{STACK_NAME}/tavus" if STACK_NAME else "")

# Keys read from the Tavus secret JSON. DAILY_API_KEY is intentionally NOT here:
# with TavusTransport the room is created on Tavus's own Daily account, so no
# separate Daily key is needed.
_TAVUS_SECRET_KEYS = ("TAVUS_API_KEY", "TAVUS_REPLICA_ID", "TAVUS_PERSONA_ID")

# Seconds to wait for the Tavus replica to initialize before the greeting.
AVATAR_WARMUP_SECONDS = float(os.environ.get("AVATAR_WARMUP_SECONDS", "6"))
# Max session length / idle timeout, for cost control (Tavus bills per minute).
MAX_CALL_DURATION_SECONDS = int(os.environ.get("MAX_CALL_DURATION_SECONDS", "600"))
IDLE_TIMEOUT_SECONDS = int(os.environ.get("IDLE_TIMEOUT_SECONDS", "120"))

GREETING = (
    "Greet the user in one short sentence as the Trinity Reserve Bank "
    "relationship manager, then ask how you can help. Speak in English."
)


def _load_tavus_secret() -> None:
    """Populate Tavus env vars from Secrets Manager if not already set.

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
    """True only when the Tavus transport can be constructed.

    The `/{stack}/tavus` secret ships with empty placeholders until the operator
    populates it. Without this guard the worker would raise mid-session; instead
    a session refuses cleanly and the container stays healthy.
    """
    return bool(os.environ.get("TAVUS_API_KEY") and os.environ.get("TAVUS_REPLICA_ID"))


def _resolve_identity(body: dict) -> tuple[str, str, str]:
    """Read the server-verified caller identity, persona, and voice from the body.

    The Cognito-authorized offer endpoint injects `user_id` (the verified `sub`)
    and optional `persona`/`voiceId` into the session body; the browser never
    supplies its own `user_id`. An empty `user_id` leaves scoped tools refusing
    (fail-closed). The voice defaults to the task's configured `VOICE_ID`.
    """
    if not isinstance(body, dict):
        return "", DEFAULT_PERSONA, VOICE_ID
    user_id = body.get("user_id", "") or ""
    persona = body.get("persona", DEFAULT_PERSONA) or DEFAULT_PERSONA
    voice_id = body.get("voiceId", "") or body.get("voice_id", "") or VOICE_ID
    return user_id, persona, voice_id


async def run_session(body: dict, url_future: "asyncio.Future | None" = None) -> None:
    """Run one avatar session end to end.

    Builds the Nova Sonic pipeline on a `TavusTransport`, which creates the Tavus
    conversation (a Daily room hosted by Tavus) when the pipeline starts. The
    room URL is surfaced through `on_connected` and, when provided, resolved onto
    `url_future` so the HTTP handler can hand it back to the browser while this
    coroutine keeps running the session.
    """
    user_id, persona, voice_id = _resolve_identity(body)
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
        # TavusTransport creates the conversation on Tavus's Daily account; no
        # DAILY_API_KEY is needed. persona_id defaults to Tavus's "pipecat" echo
        # persona so Tavus renders OUR audio (Nova Sonic) rather than running its
        # own model/voice.
        transport = TavusTransport(
            bot_name="Trinity Reserve Bank Advisor",
            api_key=os.environ["TAVUS_API_KEY"],
            replica_id=replica_id,
            session=http,
            params=TavusParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                microphone_out_enabled=False,
                audio_out_faster_than_realtime=True,
            ),
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
        agent_transcript = AgentTranscriptForwarder()

        # Nova Sonic pushes user TranscriptionFrame UPSTREAM, so
        # user_transcript sits between the LLM and the aggregator.
        pipeline = Pipeline(
            [
                transport.input(),
                context_aggregator.user(),
                user_transcript,
                llm,
                agent_transcript,
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

        @transport.event_handler("on_connected")
        async def _on_connected(transport, data):  # noqa: ANN001
            # Tavus reports the room via callConfig.roomName. Reconstruct the
            # conversation URL the browser joins and hand it to the HTTP handler.
            room_name = (data or {}).get("callConfig", {}).get("roomName")
            if room_name:
                conversation_url = f"https://tavus.daily.co/{room_name}"
                logger.info("[TAVUS] Conversation URL: {}", conversation_url)
                if url_future is not None and not url_future.done():
                    url_future.set_result(conversation_url)

        @transport.event_handler("on_client_connected")
        async def _on_client_connected(transport, participant):  # noqa: ANN001
            await start_conversation("client connected")

        @transport.event_handler("on_client_disconnected")
        async def _on_client_disconnected(transport, participant):  # noqa: ANN001
            logger.info("[TAVUS] client disconnected — cancelling task")
            await task.cancel()

        runner = PipelineRunner(handle_sigint=False)
        try:
            await runner.run(task)
        finally:
            # If the session ended before we ever connected, unblock the waiter
            # with an error instead of leaving the HTTP handler hanging.
            if url_future is not None and not url_future.done():
                url_future.set_exception(RuntimeError("session ended before connect"))
