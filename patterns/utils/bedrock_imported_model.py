"""Strands model provider for a Bedrock **Custom Import** model (e.g. a
fine-tuned Llama served via Custom Model Import).

Why this exists: imported models are invoked with ``InvokeModel`` /
``InvokeModelWithResponseStream`` using the model's native prompt format. They
do NOT support the Bedrock Converse API — probing the fine-tuned Llama-3.2 ARN
returns ``ValidationException: This action doesn't support the model`` from
``converse`` — so Strands' stock ``BedrockModel`` (which speaks Converse) cannot
drive them. This provider formats the conversation into the Llama-3 chat
template, streams the raw ``generation`` tokens back, and adapts them to the
Strands streaming-event contract.

Scope: TEXT generation only. Imported-model tool calling would require emitting
and parsing Llama's tool prompt format, which is out of scope — ``tool_specs``
are accepted and ignored, so an agent given tools still answers in the model's
fine-tuned voice but does not invoke them on the custom-model path.

This module imports Strands, so it must not be imported by the LiveKit worker
image (which does not install Strands).
"""

import asyncio
import json
import logging
import threading
from collections.abc import AsyncGenerator, AsyncIterable
from typing import Any, TypeVar

import boto3
from botocore.config import Config as BotocoreConfig
from pydantic import BaseModel
from strands.models import Model
from strands.types.content import Messages
from strands.types.streaming import StreamEvent

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Llama-3 chat special tokens.
_BOT = "<|begin_of_text|>"
_EOT = "<|eot_id|>"


def _hdr(role: str) -> str:
    return f"<|start_header_id|>{role}<|end_header_id|>\n\n"


def _block_text(block: dict) -> str:
    """Best-effort text from a Strands content block (text or tool result)."""
    if "text" in block:
        return str(block["text"])
    if "toolResult" in block:
        parts = []
        for item in block["toolResult"].get("content", []) or []:
            if isinstance(item, dict) and "text" in item:
                parts.append(str(item["text"]))
        return "\n".join(parts)
    return ""


class BedrockImportedModel(Model):
    """Text-only Strands provider for a Bedrock Custom Import model ARN."""

    def __init__(
        self,
        model_id: str,
        *,
        region: str,
        max_tokens: int = 2048,
        temperature: float = 0.3,
    ) -> None:
        self.config: dict[str, Any] = {
            "model_id": model_id,
            "region": region,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        # Generous read timeout: a long completion streams over one connection.
        self._client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=BotocoreConfig(read_timeout=900, connect_timeout=60, retries={"max_attempts": 3}),
        )
        logger.info("[CUSTOM-MODEL] BedrockImportedModel bound to %s (%s)", model_id, region)

    # ── Config plumbing (Model ABC) ──────────────────────────────────────
    def update_config(self, **model_config: Any) -> None:
        self.config.update(model_config)

    def get_config(self) -> dict[str, Any]:
        return self.config

    # ── Prompt formatting ────────────────────────────────────────────────
    def _format_prompt(self, messages: Messages, system_prompt: str | None) -> str:
        chunks = [_BOT]
        if system_prompt:
            chunks.append(_hdr("system") + system_prompt + _EOT)
        for message in messages:
            role = "assistant" if message.get("role") == "assistant" else "user"
            text = "\n".join(t for block in message.get("content", []) if (t := _block_text(block))).strip()
            if text:
                chunks.append(_hdr(role) + text + _EOT)
        chunks.append(_hdr("assistant"))
        return "".join(chunks)

    # ── Streaming ────────────────────────────────────────────────────────
    async def stream(
        self,
        messages: Messages,
        tool_specs: list[Any] | None = None,  # accepted, ignored (text-only)
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterable[StreamEvent]:
        prompt = self._format_prompt(messages, system_prompt)
        body = json.dumps(
            {
                "prompt": prompt,
                "max_gen_len": int(self.config["max_tokens"]),
                "temperature": float(self.config["temperature"]),
            }
        )

        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()
        done = object()

        def _worker() -> None:
            # boto3's event stream is a blocking iterator; run it off the event
            # loop and hand chunks back thread-safely.
            try:
                resp = self._client.invoke_model_with_response_stream(modelId=self.config["model_id"], body=body)
                for event in resp["body"]:
                    chunk = event.get("chunk")
                    if not chunk:
                        continue
                    data = json.loads(chunk["bytes"].decode())
                    loop.call_soon_threadsafe(queue.put_nowait, ("chunk", data))
            except Exception as exc:  # surfaced to the async side, never swallowed
                loop.call_soon_threadsafe(queue.put_nowait, ("error", exc))
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, (done, None))

        threading.Thread(target=_worker, daemon=True).start()

        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"start": {}}}

        out_tokens = 0
        in_tokens = 0
        stop = "end_turn"
        while True:
            tag, value = await queue.get()
            if tag is done:
                break
            if tag == "error":
                raise value
            text = value.get("generation", "")
            if text:
                yield {"contentBlockDelta": {"delta": {"text": text}}}
            if value.get("generation_token_count"):
                out_tokens = value["generation_token_count"]
            if value.get("prompt_token_count"):
                in_tokens = value["prompt_token_count"]
            raw_stop = value.get("stop_reason")
            if raw_stop:
                stop = "max_tokens" if raw_stop == "length" else "end_turn"

        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": stop}}
        yield {
            "metadata": {
                "usage": {
                    "inputTokens": in_tokens,
                    "outputTokens": out_tokens,
                    "totalTokens": in_tokens + out_tokens,
                },
                "metrics": {"latencyMs": 0},
            }
        }

    # ── Structured output (rarely used on the chatbot path) ──────────────
    async def structured_output(
        self, output_model: type[T], prompt: Messages, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Best-effort: generate once, parse the first JSON object into the model.

        The chatbot path does not use structured output, so this stays minimal —
        it accumulates the stream and validates whatever JSON the model emits.
        """
        buffer = ""
        async for event in self.stream(prompt, None, system_prompt, **kwargs):
            delta = event.get("contentBlockDelta", {}).get("delta", {})
            if "text" in delta:
                buffer += delta["text"]
        start, end = buffer.find("{"), buffer.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError("Custom model did not return a JSON object for structured output")
        yield {"output": output_model.model_validate_json(buffer[start : end + 1])}
