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
from utils.auth import get_gateway_access_token
from utils.pipeline_scope import VALID_PIPELINES, PipelineScopeHook
from utils.ssm import get_ssm_parameter

# --- Configuration (defaults, overridden per-connection by query params) ---

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
MODEL_ID = os.environ.get("MODEL_ID", "amazon.nova-2-sonic-v1:0")
DEFAULT_PERSONA = os.environ.get("PERSONA", "friendly")
DEFAULT_VOICE_ID = os.environ.get("VOICE_ID", "tiffany")
INPUT_SAMPLE_RATE = int(os.environ.get("INPUT_SAMPLE_RATE", "16000"))
OUTPUT_SAMPLE_RATE = int(os.environ.get("OUTPUT_SAMPLE_RATE", "24000"))

# Known tool names for system prompt augmentation (since MCP client
# isn't connected at agent creation time, we list what the Gateway provides)
GATEWAY_TOOL_NAMES = [
    "gateway_kb_search",
    "gateway_web_search",
    "gateway_data_sources",
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
    persona: str = DEFAULT_PERSONA,
    voice_id: str = DEFAULT_VOICE_ID,
    sensitivity: str = "MEDIUM",
    kb_pipelines_holder: list[list[str] | None] | None = None,
) -> tuple[BidiAgent, str]:
    """Create a BidiAgent configured for voice conversation.

    Args:
        kb_pipelines_holder: Optional single-element mutable list whose value is
            the current kb pipelines multi-select (e.g. ["bistro_research", "menu"]).
            When None or empty, the avatar searches every pipeline view.
            The holder is referenced by the PipelineScopeHook on every tool call,
            so mid-session changes (via kbPipelinesChange WebSocket messages)
            take effect on the very next kb_search call.
    """
    logger.info(
        "[AVATAR] Creating BidiNovaSonicModel: model=%s, region=%s, voice=%s, sensitivity=%s",
        MODEL_ID,
        BEDROCK_REGION,
        voice_id,
        sensitivity,
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

    # Build a PipelineScopeHook backed by the mutable holder so the user's
    # chip multi-select is honored mid-session without re-creating the agent.
    hooks: list = []
    if kb_pipelines_holder is not None:

        def _read_filter_provider() -> list[str] | None:
            # Always read the latest value — the holder is a single-element list
            # whose only element is mutated when the frontend sends kbPipelinesChange.
            return kb_pipelines_holder[0] if kb_pipelines_holder else None

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
    initial_kb_pipelines = _parse_kb_pipelines(websocket.query_params.get("kb_pipelines"))
    # Single-element holder so the hook always reads the latest value. The
    # holder is mutated in-place on kbPipelinesChange WebSocket messages.
    kb_pipelines_holder: list[list[str] | None] = [initial_kb_pipelines]

    logger.info(
        "[AVATAR] Connection params: persona=%s, voice=%s, language=%s, sensitivity=%s, kb_pipelines=%r",
        persona,
        voice_id,
        language,
        sensitivity,
        initial_kb_pipelines,
    )

    try:
        # Step 1: Authenticate with Gateway
        logger.info("[AVATAR] Step 1: Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        logger.info("[AVATAR] Got access token: %s...", access_token[:20])

        # Step 2: Create Gateway MCP client
        logger.info("[AVATAR] Step 2: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client(access_token)

        # Step 3: Create BidiAgent with per-connection persona and voice
        logger.info("[AVATAR] Step 3: Creating BidiAgent...")
        agent, system_prompt = create_avatar_agent(
            tools=[gateway_client],
            persona=persona,
            voice_id=voice_id,
            sensitivity=sensitivity,
            kb_pipelines_holder=kb_pipelines_holder,
        )

        # Step 4: Accept WebSocket and run bidirectional streaming
        logger.info("[AVATAR] Step 4: Accepting WebSocket and starting voice conversation...")
        await websocket.accept()
        logger.info("[AVATAR] WebSocket connection accepted")

        # Handle initial sessionStart from frontend (control message, not audio)
        first_msg = await websocket.receive_json()
        session_id = None
        if isinstance(first_msg, dict) and first_msg.get("type") == "sessionStart":
            session_id = first_msg.get("sessionId", "unknown")
            logger.info("[AVATAR] Received sessionStart, session_id=%s", session_id)
            await websocket.send_json({"type": "sessionStart", "sessionId": session_id})
        else:
            logger.warning(
                "[AVATAR] First message was not sessionStart: %s",
                first_msg.get("type") if isinstance(first_msg, dict) else type(first_msg),
            )

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
            pass


# --- Application Entry ---

if __name__ == "__main__":
    import uvicorn

    host = "0.0.0.0" if os.environ.get("DOCKER_CONTAINER") else "127.0.0.1"
    logger.info(
        "Starting avatar agent: model=%s, region=%s, host=%s",
        MODEL_ID,
        BEDROCK_REGION,
        host,
    )
    uvicorn.run(app, host=host, port=8080)
