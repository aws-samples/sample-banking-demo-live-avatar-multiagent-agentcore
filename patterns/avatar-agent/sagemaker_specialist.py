"""SageMaker-backed specialist tool for the Avatar/Digital Human.

Nova Sonic is a speech-to-speech model — its reasoning is baked in, so a custom
model can't be swapped in as its "brain." Instead we expose Trinity Reserve's
fine-tuned model (a Qwen3-8B + LoRA adapter served on a SageMaker inference
endpoint, OpenAI chat-completions compatible) as a Strands `@tool`. Nova Sonic
calls it for substantive banking questions and speaks the returned answer, so
the digital human is *reasoned* by the custom model while keeping Nova Sonic's
low-latency voice.

Enabled only when SAGEMAKER_ENDPOINT_NAME is set on the avatar runtime (gated by
`features.sagemaker_model` in CDK). When unset, `build_specialist_tool()` returns
None and the avatar runs exactly as before.

Endpoint traits handled (verified empirically against the demo endpoint):
  - Inference-component endpoint -> InferenceComponentName header is REQUIRED.
  - Reasoning model -> emits a <think>...</think> block unless disabled. We send
    vLLM's chat_template_kwargs={"enable_thinking": false} and also strip any
    residual <think> block as a safety net so it's never spoken.
"""

import json
import logging
import os
import re

import boto3
from botocore.config import Config as BotocoreConfig
from strands import tool

logger = logging.getLogger(__name__)

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)

_ENDPOINT = os.environ.get("SAGEMAKER_ENDPOINT_NAME", "").strip()
_INFERENCE_COMPONENT = os.environ.get("SAGEMAKER_INFERENCE_COMPONENT_NAME", "").strip()
_REGION = os.environ.get("SAGEMAKER_REGION") or os.environ.get("AWS_REGION", "us-east-1")
# Voice answers should be short; keep the token budget tight for latency.
_MAX_TOKENS = int(os.environ.get("SAGEMAKER_MAX_TOKENS", "512"))
_ENABLE_THINKING = os.environ.get("SAGEMAKER_ENABLE_THINKING", "false").lower() == "true"

_SPECIALIST_SYSTEM = (
    "You are Trinity Reserve's specialist banking assistant. Answer the customer's "
    "question directly and concisely for a spoken reply: 1-3 sentences, plain "
    "language, no markdown, no lists. Only discuss Trinity Reserve products and "
    "services."
)


def _clean(text: str) -> str:
    """Strip any residual <think> reasoning and collapse whitespace."""
    text = _THINK_BLOCK.sub("", text or "")
    # Drop a dangling, unclosed <think> (truncated generation) too.
    if "<think>" in text:
        text = text.split("<think>", 1)[0]
    return " ".join(text.split()).strip()


def build_specialist_tool():
    """Return the `trinity_specialist` @tool, or None when no endpoint is set."""
    if not _ENDPOINT:
        return None

    runtime = boto3.client(
        "sagemaker-runtime",
        region_name=_REGION,
        config=BotocoreConfig(read_timeout=30, retries={"max_attempts": 2}),
    )

    @tool(
        name="trinity_specialist",
        description=(
            "Trinity Reserve's fine-tuned specialist model. Call this to answer a "
            "customer's substantive questions about Trinity Reserve products, "
            "accounts, fees, eligibility, or financial guidance. Returns a short, "
            "customer-ready answer — speak it to the customer as-is, without adding "
            "or changing information."
        ),
    )
    def trinity_specialist(question: str) -> str:
        """Answer a Trinity Reserve banking question with the specialist model.

        Args:
            question: The customer's question, in plain language.
        """
        payload = {
            "messages": [
                {"role": "system", "content": _SPECIALIST_SYSTEM},
                {"role": "user", "content": question},
            ],
            "max_tokens": _MAX_TOKENS,
            "temperature": 0.3,
            "stream": False,
        }
        if not _ENABLE_THINKING:
            payload["chat_template_kwargs"] = {"enable_thinking": False}

        kwargs = {
            "EndpointName": _ENDPOINT,
            "ContentType": "application/json",
            "Accept": "application/json",
            "Body": json.dumps(payload).encode("utf-8"),
        }
        if _INFERENCE_COMPONENT:
            kwargs["InferenceComponentName"] = _INFERENCE_COMPONENT

        try:
            resp = runtime.invoke_endpoint(**kwargs)
            body = json.loads(resp["Body"].read().decode("utf-8", "replace"))
            content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            answer = _clean(content)
            if not answer:
                logger.warning("[AVATAR] specialist returned empty content")
                return "I couldn't find a specific answer to that right now."
            return answer
        except Exception as exc:  # noqa: BLE001 - tool must never crash the voice loop
            logger.warning("[AVATAR] trinity_specialist invoke failed: %s", exc)
            return "I'm having trouble reaching that information at the moment."

    return trinity_specialist
