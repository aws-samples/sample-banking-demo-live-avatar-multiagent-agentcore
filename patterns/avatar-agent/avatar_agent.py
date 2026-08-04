"""
Avatar Agent - Real-time voice conversation using Strands BidiAgent + Nova Sonic on AgentCore Runtime.

Uses FastAPI + uvicorn (matching aws-samples/sample-nova-sonic-websocket-agentcore pattern).
BidiAgent with BidiNovaSonicModel for bidirectional audio streaming over WebSocket.
Connects to AgentCore Gateway for tool access (canvas, reel, memory, search, profile)
and loads persona prompts for voice-optimized system instructions.

Deployment: Docker container on AgentCore Runtime, exposed on port 8080 via uvicorn.
Audio: 16kHz PCM input, 24kHz PCM output, streamed bidirectionally through the Nova Sonic model.
"""

import json
import logging
import os
import traceback

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from mcp.client.streamable_http import streamablehttp_client
from persona_prompts import get_persona_prompt
from strands.experimental.bidi import BidiAgent
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.tools.mcp import MCPClient
from system_prompt_augmenter import augment_system_prompt
from utils.auth import extract_user_id_from_token, get_gateway_access_token
from utils.pipeline_scope import VALID_PIPELINES, PipelineScopeHook
from utils.ssm import get_ssm_parameter
from utils.tool_guard import UserScopeHook

# --- Configuration (defaults, overridden per-connection by query params) ---

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_PERSONA = os.environ.get("PERSONA", "friendly")
DEFAULT_VOICE_ID = os.environ.get("VOICE_ID", "tiffany")
INPUT_SAMPLE_RATE = int(os.environ.get("INPUT_SAMPLE_RATE", "16000"))
OUTPUT_SAMPLE_RATE = int(os.environ.get("OUTPUT_SAMPLE_RATE", "24000"))

# Known tool names for system prompt augmentation (since MCP client
# isn't connected at agent creation time, we list what the Gateway provides).
# Must stay in sync with `toolDefs` in lib/stacks/backend/index.ts. The
# `sample_tool` (word-counter demo) is intentionally excluded — it has no
# voice-conversation utility.
GATEWAY_TOOL_NAMES = [
    "gateway_kb_search",
    "gateway_web_search",
    "gateway_data_sources",
    "gateway_pdf_generator",
    "gateway_website_generator",
    "gateway_extract_pdf_images",
    "gateway_nova_canvas_generate",
    "gateway_nova_canvas_edit",
    "gateway_nova_canvas_history",
    "gateway_nova_reel_generate",
    "gateway_nova_reel_status",
    "gateway_nova_reel_history",
    "gateway_save_memory",
    "gateway_recall_memories",
    "gateway_analyze_patterns",
    "gateway_retrieve_user_profile",
    "gateway_place_order",
]

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=os.environ.get("LOGLEVEL", "INFO").upper(),
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)


def _parse_kb_pipelines(raw) -> list[str] | None:
    """Parse a kb_pipelines value (str or list) into a validated list, or None.

    Accepts either a list of strings (from JSON payload) or a comma-separated
    string (from query-string param). Returns None when the value is missing
    or resolves to zero valid entries, which means "search every pipeline".
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(",") if p.strip()]
    if not isinstance(raw, list):
        logger.warning("[AVATAR] kb_pipelines must be list or comma-string, got %r", type(raw).__name__)
        return None
    cleaned = [p for p in raw if isinstance(p, str) and p in VALID_PIPELINES]
    if len(cleaned) != len(raw):
        logger.warning("[AVATAR] kb_pipelines ignored unknown values: raw=%r cleaned=%r", raw, cleaned)
    return cleaned if cleaned else None


# FastAPI app (matching reference pattern from aws-samples/sample-nova-sonic-websocket-agentcore)
app = FastAPI()


# --- Health Check (required by AgentCore) ---


@app.get("/ping")
async def ping():
    """Health check endpoint for AgentCore Runtime."""
    from datetime import datetime

    return {"status": "Healthy", "time_of_last_update": int(datetime.now().timestamp())}


# --- Gateway MCP Client ---


def create_gateway_mcp_client(access_token: str) -> MCPClient:
    """Create MCP client for AgentCore Gateway with OAuth2 authentication."""
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    logger.info("[AVATAR] Creating Gateway MCP client for stack: %s", stack_name)

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    logger.info("[AVATAR] Gateway URL from SSM: %s", gateway_url)

    gateway_client = MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
    )

    logger.info("[AVATAR] Gateway MCP client created successfully")
    return gateway_client


# --- BidiAgent Factory ---


def create_avatar_agent(
    tools: list,
    user_id: str,
    persona: str = DEFAULT_PERSONA,
    voice_id: str = DEFAULT_VOICE_ID,
    sensitivity: str = "MEDIUM",
    kb_pipelines_holder: list[list[str] | None] | None = None,
) -> tuple[BidiAgent, str]:
    """Create a BidiAgent configured for voice conversation.

    Args:
        user_id: Verified Cognito `sub` claim, extracted from the id_token
            sent in the first `sessionStart` WebSocket message. Attached
            to every user-scoped gateway tool call by UserScopeHook — the
            LLM cannot spoof another user's identity.
        kb_pipelines_holder: Optional single-element mutable list whose value is
            the current kb pipelines multi-select (e.g. ["strategy_research", "menu"]).
            When None or empty, the avatar searches every pipeline view.
            The holder is referenced by the PipelineScopeHook on every tool call,
            so mid-session changes (via kbPipelinesChange WebSocket messages)
            take effect on the very next kb_search call.
    """
    if not user_id:
        # Defensive — the websocket handler should always extract a user_id
        # before calling us, but make the contract loud rather than silently
        # producing a cross-tenant agent.
        raise ValueError("create_avatar_agent requires a non-empty user_id")

    logger.info(
        "[AVATAR] Creating BidiNovaSonicModel: model=%s, region=%s, voice=%s, sensitivity=%s, user_id=%s",
        MODEL_ID,
        BEDROCK_REGION,
        voice_id,
        sensitivity,
        user_id,
    )

    model = BidiNovaSonicModel(
        model_id=MODEL_ID,
        provider_config={
            "audio": {
                "voice": voice_id,
                "input_rate": INPUT_SAMPLE_RATE,
                "output_rate": OUTPUT_SAMPLE_RATE,
                "channels": 1,
                "format": "pcm",
                "audio_type": "SPEECH",
            },
            "inference": {
                "max_tokens": 1024,
                "temperature": 0.7,
                "top_p": 0.9,
            },
            "turn_detection": {
                "endpointingSensitivity": sensitivity,
            },
        },
        client_config={
            "region": BEDROCK_REGION,
        },
    )

    # Load and augment persona prompt
    base_prompt = get_persona_prompt(persona)
    system_prompt = augment_system_prompt(base_prompt, GATEWAY_TOOL_NAMES)

    # Hooks force-inject the verified user_id and mode-specific KB read filter
    # into all relevant Gateway tool calls. The avatar wires both: UserScopeHook
    # matches the orchestrator's behavior; PipelineScopeHook honors the user's
    # chip multi-select mid-session without re-creating the agent.
    hooks: list = [UserScopeHook(user_id)]
    if kb_pipelines_holder is not None:

        def _read_filter_provider() -> list[str] | None:
            # Always read the latest value — the holder is a single-element list
            # whose only element is mutated when the frontend sends kbPipelinesChange.
            #
            # UI semantics: the chip bar's "All" state maps to an empty list
            # on the wire (see lib/stacks/frontend/app/src/stores/avatarKbPipelinesStore.ts).
            # Here we expand that to the full valid-pipeline set so the fail-closed
            # PipelineScopeHook injects a real list into kb_search rather than
            # refusing the call. Any user-selected subset is returned as-is.
            raw = kb_pipelines_holder[0] if kb_pipelines_holder else None
            if not raw:
                return list(VALID_PIPELINES)
            return raw

        hooks.append(PipelineScopeHook(read_filter=_read_filter_provider))

    logger.info("[AVATAR] Persona: %s, tools: %d, hooks: %d", persona, len(tools), len(hooks))

    agent = BidiAgent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,
        hooks=hooks,
    )

    logger.info("[AVATAR] BidiAgent created successfully")
    return agent, system_prompt


# --- WebSocket Entrypoint ---


@app.websocket("/ws")
async def websocket_handler(websocket: WebSocket, request_context=None):
    """
    WebSocket endpoint for real-time voice conversation on AgentCore Runtime.

    Authentication: the Cognito ID token is sent inside the first
    `sessionStart` JSON message from the frontend, not the handshake URL.
    AgentCore Runtime's WebSocket proxy does not forward arbitrary query-
    string params to the inner container, so query-string auth silently
    fails. Using `sessionStart` keeps auth on a transport the proxy does
    not touch. Cognito Identity Pool already verified the token upstream
    when issuing the SigV4 credentials, so we parse the `sub` claim
    without re-verifying the signature. A missing or malformed id_token
    causes a post-accept close with code 4401.

    Matches the pattern from aws-samples/sample-nova-sonic-websocket-agentcore:
    - Accepts WebSocket connection explicitly
    - Uses agent.run(inputs=[receive_json], outputs=[send_json])
    - Reads persona/voice from query params
    """
    logger.info("[AVATAR] New WebSocket connection")

    # Read persona/voice/language from query params (sent by frontend)
    persona = websocket.query_params.get("persona", DEFAULT_PERSONA)
    voice_id = websocket.query_params.get("voice_id", DEFAULT_VOICE_ID)
    language = websocket.query_params.get("language", "en-US")
    sensitivity = websocket.query_params.get("sensitivity", "MEDIUM").upper()
    if sensitivity not in ("HIGH", "MEDIUM", "LOW"):
        sensitivity = "MEDIUM"

    # Voice Avatar KB pipeline multi-select. Default (None) = search every view.
    # Query-string form is kept as a fallback seed — the authoritative source
    # is the sessionStart JSON message below.
    initial_kb_pipelines = _parse_kb_pipelines(websocket.query_params.get("kb_pipelines"))
    # Single-element holder so the hook always reads the latest value. The
    # holder is mutated in-place on kbPipelinesChange WebSocket messages.
    kb_pipelines_holder: list[list[str] | None] = [initial_kb_pipelines]

    # Accept the socket BEFORE any JSON reads. A pre-accept close cannot
    # send a custom close code through Starlette/FastAPI; the browser sees
    # an HTTP upgrade failure / 1006 and auto-reconnects. Post-accept close
    # with code 4401 IS valid and is what we want for an auth failure.
    await websocket.accept()
    logger.info("[AVATAR] WebSocket connection accepted")

    try:
        # ── Verify identity from the first JSON message ─────────────────
        # Frontend sends sessionStart with idToken as the very first message
        # after connect. On missing/invalid token we close with code 4401
        # and the client stops reconnecting (see AvatarWebSocketClient
        # maxReconnectAttempts).
        first_msg = await websocket.receive_json()
        session_id = None
        id_token = ""
        if isinstance(first_msg, dict) and first_msg.get("type") == "sessionStart":
            session_id = first_msg.get("sessionId", "unknown")
            id_token = first_msg.get("idToken", "")
            logger.info("[AVATAR] Received sessionStart, session_id=%s", session_id)
            # sessionStart may also carry kbPipelines — honor it as the
            # authoritative initial scope (query-string path is a fallback).
            if "kbPipelines" in first_msg:
                parsed = _parse_kb_pipelines(first_msg.get("kbPipelines"))
                kb_pipelines_holder[0] = parsed
                logger.info("[AVATAR] sessionStart kbPipelines=%r", parsed)
        else:
            logger.warning(
                "[AVATAR] First message was not sessionStart: %s",
                first_msg.get("type") if isinstance(first_msg, dict) else type(first_msg),
            )

        try:
            user_id = extract_user_id_from_token(id_token)
        except ValueError as exc:
            logger.warning("[AVATAR] Refusing connection — invalid id_token: %s", exc)
            await websocket.send_json({"type": "error", "content": "invalid_id_token"})
            await websocket.close(code=4401, reason="invalid_id_token")
            return

        logger.info(
            "[AVATAR] Connection params: user_id=%s, persona=%s, voice=%s, language=%s, sensitivity=%s, kb_pipelines=%r",
            user_id,
            persona,
            voice_id,
            language,
            sensitivity,
            kb_pipelines_holder[0],
        )

        # Step 1: Authenticate with Gateway
        logger.info("[AVATAR] Step 1: Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        logger.info("[AVATAR] Got access token: %s...", access_token[:20])

        # Step 2: Create Gateway MCP client
        logger.info("[AVATAR] Step 2: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client(access_token)

        # Step 3: Create BidiAgent with per-connection persona and voice.
        # Deferred until after sessionStart so UserScopeHook(user_id) gets
        # the verified Cognito `sub` from the sessionStart idToken.
        logger.info("[AVATAR] Step 3: Creating BidiAgent...")
        agent, system_prompt = create_avatar_agent(
            tools=[gateway_client],
            user_id=user_id,
            persona=persona,
            voice_id=voice_id,
            sensitivity=sensitivity,
            kb_pipelines_holder=kb_pipelines_holder,
        )

        # Ack sessionStart now that auth + agent are ready.
        await websocket.send_json({"type": "sessionStart", "sessionId": session_id})

        # --- Translation wrappers ---
        # Frontend sends {type:"audio", audioData} / {type:"text", content}
        # BidiAgent expects bidi_* prefixed messages
        async def receive_wrapper():
            """Translate frontend messages to BidiAgent format."""
            while True:
                msg = await websocket.receive_json()
                msg_type = msg.get("type") if isinstance(msg, dict) else None

                if msg_type == "audio":
                    return {
                        "type": "bidi_audio_input",
                        "audio": msg.get("audioData", ""),
                        "format": "pcm",
                        "sample_rate": INPUT_SAMPLE_RATE,
                        "channels": 1,
                    }
                elif msg_type == "text":
                    return {
                        "type": "bidi_text_input",
                        "text": msg.get("content", ""),
                        "role": "user",
                    }
                elif msg_type == "kbPipelinesChange":
                    # Mid-session chip toggle — mutate the holder so the
                    # PipelineScopeHook's read_filter provider picks up the
                    # new scope on the very next kb_search call. The hook
                    # was attached to the agent at connect time with a
                    # closure over this same holder; we don't need to
                    # rebuild the agent.
                    parsed = _parse_kb_pipelines(msg.get("kbPipelines"))
                    kb_pipelines_holder[0] = parsed
                    logger.info("[AVATAR] kbPipelinesChange: holder=%r", parsed)
                    continue
                elif msg_type in (
                    "sessionStart",
                    "ping",
                    "personaChange",
                    "languageChange",
                    "voiceChange",
                ):
                    # Control messages — silently drop, loop for next real message
                    logger.debug("[AVATAR] Dropping control message: %s", msg_type)
                    continue
                else:
                    logger.warning("[AVATAR] Unknown message type, passing through: %s", msg_type)
                    return msg

        # Track the last tool name from tool_use events so we can
        # attach it to tool_result events (which don't carry the name)
        last_tool_name_holder = [""]

        async def send_wrapper(event: dict):
            """Translate BidiAgent events to frontend format."""
            event_type = event.get("type") if isinstance(event, dict) else None

            # Debug: log all non-audio events to understand BidiAgent event flow
            if event_type not in ("bidi_audio_stream",):
                logger.info(
                    "[AVATAR] send_wrapper event: type=%s keys=%s",
                    event_type,
                    list(event.keys()) if isinstance(event, dict) else "not-dict",
                )

            if event_type == "bidi_audio_stream":
                await websocket.send_json({"type": "audio", "audioData": event.get("audio", "")})
            elif event_type == "bidi_transcript_stream":
                await websocket.send_json(
                    {
                        "type": "text",
                        "content": event.get("text", ""),
                        "role": event.get("role", "assistant"),
                    }
                )
            elif event_type == "bidi_connection_start":
                await websocket.send_json({"type": "sessionStart"})
            elif event_type == "bidi_response_complete":
                await websocket.send_json({"type": "sessionEnd"})
            elif event_type == "bidi_error":
                await websocket.send_json({"type": "error", "content": event.get("message", "Unknown error")})
            elif event_type in ("tool_use", "tool_use_stream"):
                # BidiAgent sends tool_use_stream with current_tool_use dict
                # Track tool name — tool_result events don't carry it
                ctu = event.get("current_tool_use", {})
                tool_name_val = ctu.get("name", "") if isinstance(ctu, dict) else event.get("name", "")
                if tool_name_val:
                    last_tool_name_holder[0] = tool_name_val
                await websocket.send_json(
                    {
                        "type": "toolInvocation",
                        "toolName": last_tool_name_holder[0],
                        "toolInput": ctu.get("input") if isinstance(ctu, dict) else event.get("input"),
                    }
                )
            elif event_type == "tool_result":
                # BidiAgent tool_result structure (from logs):
                # {"type": "tool_result", "tool_result": {
                #   "status": "success", "toolUseId": "...",
                #   "content": [{"text": '{"query":"...","documents":[...]}'}]
                # }}
                # Note: no "name" field — use last_tool_name from tool_use event.
                tr = event.get("tool_result", {})
                tool_name = last_tool_name_holder[0]  # from the preceding tool_use event

                # Extract the inner text from MCP content items
                # Same logic as Chat's strands.ts parser:
                #   block.toolResult.content.map(c => c.text).join("")
                unwrapped_result = ""
                result_data = None
                try:
                    content_items = tr.get("content", []) if isinstance(tr, dict) else []
                    if isinstance(content_items, list) and content_items:
                        texts = [
                            item.get("text", "")
                            for item in content_items
                            if isinstance(item, dict) and item.get("text")
                        ]
                        unwrapped_result = "".join(texts)
                    elif isinstance(tr, str):
                        unwrapped_result = tr

                    # Try to parse the unwrapped text as JSON for media/doc extraction
                    if unwrapped_result:
                        try:
                            result_data = json.loads(unwrapped_result)
                        except (json.JSONDecodeError, TypeError):
                            pass
                except Exception:
                    logger.warning("[AVATAR] Failed to unwrap tool_result", exc_info=True)

                # Send the unwrapped result so frontend gets clean data
                # (same format KbSearchResultCard expects)
                msg: dict = {
                    "type": "toolResult",
                    "toolName": tool_name,
                    "toolResult": unwrapped_result,
                }

                # Extract media URLs from unwrapped result
                if isinstance(result_data, dict):
                    if result_data.get("image_url"):
                        msg["mediaUrl"] = result_data["image_url"]
                        msg["mediaType"] = "image"
                    elif result_data.get("video_url"):
                        msg["mediaUrl"] = result_data["video_url"]
                        msg["mediaType"] = "video"

                    # Extract document URLs from kb_search results
                    # and send a pdfPreview message so the frontend opens the PDF viewer
                    documents = result_data.get("documents", [])
                    if documents and isinstance(documents, list):
                        doc = documents[0]
                        doc_url = doc.get("url")
                        if doc_url:
                            pages = doc.get("pages_referenced", [])
                            page_anchor = pages[0] if pages else None
                            pdf_url = f"{doc_url}#page={page_anchor}" if page_anchor else doc_url
                            logger.info(
                                "[AVATAR] Sending pdfPreview: %s (page %s)",
                                doc.get("filename"),
                                page_anchor,
                            )
                            await websocket.send_json(
                                {
                                    "type": "pdfPreview",
                                    "url": pdf_url,
                                    "filename": doc.get("filename", "Document"),
                                    "page": page_anchor,
                                }
                            )

                await websocket.send_json(msg)
            elif event_type == "bidi_connection_restart":
                await websocket.send_json({"type": "connectionRefreshing"})
                return
            elif event_type in ("bidi_usage", "bidi_interruption", "bidi_response_start"):
                pass  # Internal metrics / interruption / response start — silently drop
            else:
                logger.debug("[AVATAR] Passing through unhandled event: %s", event_type)
                await websocket.send_json(event)

        await agent.run(
            inputs=[receive_wrapper],
            outputs=[send_wrapper],
            invocation_state={
                "session_id": session_id or "unknown",
                "persona": persona,
                "voice_id": voice_id,
            },
        )

    except WebSocketDisconnect:
        logger.info("[AVATAR] Client disconnected")
    except Exception as e:
        logger.error("[AVATAR ERROR] WebSocket handler failed: %s", e)
        logger.error("[AVATAR ERROR] Exception type: %s", type(e).__name__)
        traceback.print_exc()
    finally:
        try:
            await websocket.close()
        except Exception:
            pass  # nosec B110 — WebSocket close in finally, double-close must not raise


# --- Application Entry ---

if __name__ == "__main__":
    import uvicorn

    host = "0.0.0.0" if os.environ.get("DOCKER_CONTAINER") else "127.0.0.1"  # nosec B104 — 0.0.0.0 required for AgentCore proxy traffic inside the runtime container; gated by DOCKER_CONTAINER env
    logger.info(
        "Starting avatar agent: model=%s, region=%s, host=%s",
        MODEL_ID,
        BEDROCK_REGION,
        host,
    )
    uvicorn.run(app, host=host, port=8080)
