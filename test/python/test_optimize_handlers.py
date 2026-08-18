"""Example/integration tests for the Prompt Optimization showcase handlers.

Concrete scenario tests (not Hypothesis property tests) for the Task 3
handlers wired into `patterns/orchestrator-agent/orchestrator_agent.py`:
`_handle_optimize_prompt` (the per-model OptimizePrompt streamer) and
`_handle_optimize_sample` (the before/after runner that reuses `_handle_chatbot`
twice). Both are exercised fully offline — the boto3 `bedrock-agent-runtime`
client and `_handle_chatbot` are replaced with fakes so no network or deploy is
required.

Coverage (see `.kiro/specs/prompt-optimization-showcase/{requirements,design}.md`):

* **Req 13.1** — `_handle_optimize_prompt` submits ONLY the Current_System_Prompt
  (`CHATBOT_PROMPT`) text, never another agent phase's prompt, and only the three
  supported foundation-model target ids (never an inference-profile / invoke id).
* **Req 10.1 / 10.2 / 10.4** — per-model failure isolation: one target raising
  still yields the other targets' optimized events, an `error` event for the
  failing one, and a terminal `step_complete` (or `step_failed` only when every
  target fails).
* **Req 7.1 / 7.2 / 7.4** — `_handle_optimize_sample` invokes `_handle_chatbot`
  once per side with the correct `requested_model` / `system_prompt_override`
  (baseline: `""` / `None`; candidate: the candidate invoke id / candidate prompt)
  and tags each streamed answer with the right variant.
* **Req 7.6** — a failure on one side still streams the other side's answer.
* **Req 13.2** — the apply/sample path only ever routes through `mode="chatbot"`
  params; it introduces no other model-invocation path.

The orchestrator module imports cleanly on the pytest pythonpath
(`patterns/orchestrator-agent`); everything under test is referenced through the
`orchestrator_agent` module object so the fakes replace exactly what the running
handlers wire.
"""

from __future__ import annotations

import asyncio
from typing import Any

import optimize_targets
import orchestrator_agent as oa
import pytest

_USER_ID = "sub-verified-123"
_SESSION_ID = "session-abc"

# The three verified foundation-model optimize-target ids, in registry order.
_SUPPORTED_IDS = [tm.optimize_target_id for tm in oa.SUPPORTED_TARGET_MODELS]


# --- Helpers --------------------------------------------------------------


def _drain(agen) -> list[dict[str, Any]]:
    """Collect every event yielded by an async generator into a list."""

    async def _collect() -> list[dict[str, Any]]:
        return [event async for event in agen]

    return asyncio.run(_collect())


def _prompt_opts(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract the `prompt_opt` payloads from a stream of yielded events."""
    return [event["prompt_opt"] for event in events if "prompt_opt" in event]


def _analysis_then_optimized(model_label: str) -> list[dict[str, Any]]:
    """A minimal successful OptimizePrompt event stream for one model."""
    return [
        {"analyzePromptEvent": {"message": f"analysis for {model_label}"}},
        {"optimizedPromptEvent": {"optimizedPrompt": {"textPrompt": {"text": f"optimized for {model_label}"}}}},
    ]


class _FakeBedrockClient:
    """Async-free stand-in for boto3 `bedrock-agent-runtime`.

    Records every `optimize_prompt(**request)` call so the test can assert the
    submitted prompt text and target ids, and returns a canned event stream on
    `response["optimizedPrompt"]`. A per-target `errors` map lets a chosen target
    raise to exercise failure isolation.
    """

    def __init__(self, *, errors: dict[str, BaseException] | None = None) -> None:
        self.errors = errors or {}
        self.requests: list[dict[str, Any]] = []

    def optimize_prompt(self, **request: Any) -> dict[str, Any]:
        self.requests.append(request)
        target_id = request.get("targetModelId", "")
        if target_id in self.errors:
            raise self.errors[target_id]
        label = next((tm.label for tm in oa.SUPPORTED_TARGET_MODELS if tm.optimize_target_id == target_id), target_id)
        return {"optimizedPrompt": _analysis_then_optimized(label)}

    @property
    def submitted_target_ids(self) -> list[str]:
        return [request.get("targetModelId", "") for request in self.requests]

    @property
    def submitted_prompt_texts(self) -> list[str]:
        return [request.get("input", {}).get("textPrompt", {}).get("text", "") for request in self.requests]


def _install_fake_bedrock(monkeypatch, client: _FakeBedrockClient) -> None:
    """Route `boto3.client("bedrock-agent-runtime", ...)` to the fake."""
    import boto3

    def _fake_client(service_name: str, *args: Any, **kwargs: Any) -> _FakeBedrockClient:
        assert service_name == "bedrock-agent-runtime"
        return client

    monkeypatch.setattr(boto3, "client", _fake_client)


class _ClientErrorLike(Exception):
    """A botocore-ClientError-shaped exception (has a `.response` dict).

    `_is_validation_exception` / `_optimize_error_reason` read `.response`.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.response = {"Error": {"Code": code, "Message": message}}


# --- _handle_optimize_prompt: submits only CHATBOT_PROMPT + supported ids -


class TestOptimizePromptSubmission:
    """Req 13.1: only the current prompt text and supported FM targets."""

    def test_submits_only_chatbot_prompt_text_for_every_target(self, monkeypatch) -> None:
        """Every OptimizePrompt request carries the Current_System_Prompt text.

        The client never supplies prompt content; the handler defaults to
        `CHATBOT_PROMPT`, and no other agent-phase prompt is ever submitted.
        """
        client = _FakeBedrockClient()
        _install_fake_bedrock(monkeypatch, client)

        _drain(oa._handle_optimize_prompt(_USER_ID, _SESSION_ID))

        assert client.submitted_prompt_texts, "expected at least one OptimizePrompt request"
        assert all(text == oa.CHATBOT_PROMPT for text in client.submitted_prompt_texts)

    def test_submits_only_supported_foundation_model_ids(self, monkeypatch) -> None:
        """Exactly the three supported FM target ids are submitted, no profiles.

        No submitted `targetModelId` is an inference-profile id, and none is a
        model's invocable `invoke_id` (which for the 4.5 targets is the `us.`
        profile form).
        """
        client = _FakeBedrockClient()
        _install_fake_bedrock(monkeypatch, client)

        _drain(oa._handle_optimize_prompt(_USER_ID, _SESSION_ID))

        assert client.submitted_target_ids == _SUPPORTED_IDS
        assert not any(optimize_targets.is_inference_profile_id(t) for t in client.submitted_target_ids)
        invoke_ids = {tm.invoke_id for tm in oa.SUPPORTED_TARGET_MODELS if tm.invoke_id != tm.optimize_target_id}
        assert not (set(client.submitted_target_ids) & invoke_ids)

    def test_emits_analysis_then_optimized_per_target_and_completes(self, monkeypatch) -> None:
        """All three targets stream analysis+optimized and the step completes."""
        client = _FakeBedrockClient()
        _install_fake_bedrock(monkeypatch, client)

        payloads = _prompt_opts(_drain(oa._handle_optimize_prompt(_USER_ID, _SESSION_ID)))

        assert payloads[0]["kind"] == "step_start"
        assert payloads[-1]["kind"] == "step_complete"
        for target_id in _SUPPORTED_IDS:
            kinds = [payload["kind"] for payload in payloads if payload.get("target_model_id") == target_id]
            assert kinds == ["analysis", "optimized"]


# --- _handle_optimize_prompt: per-model failure isolation -----------------


class TestOptimizePromptFailureIsolation:
    """Req 10.1/10.2/10.4: one target failing never aborts the others."""

    def test_one_target_error_still_streams_the_others(self, monkeypatch) -> None:
        """A generic error on one target yields an `error` event for it while

        the other two targets still produce optimized prompts and the step
        completes (at least one optimized).
        """
        failing = _SUPPORTED_IDS[1]
        client = _FakeBedrockClient(errors={failing: RuntimeError("throttled")})
        _install_fake_bedrock(monkeypatch, client)

        payloads = _prompt_opts(_drain(oa._handle_optimize_prompt(_USER_ID, _SESSION_ID)))

        failing_kinds = [payload["kind"] for payload in payloads if payload.get("target_model_id") == failing]
        assert failing_kinds == ["error"]
        for target_id in (_SUPPORTED_IDS[0], _SUPPORTED_IDS[2]):
            kinds = [payload["kind"] for payload in payloads if payload.get("target_model_id") == target_id]
            assert "optimized" in kinds
        assert payloads[-1]["kind"] == "step_complete"

    def test_validation_exception_maps_to_invalid_target(self, monkeypatch) -> None:
        """A Bedrock ValidationException on one target surfaces as

        `invalid_target` (not `error`) while the others still stream.
        """
        failing = _SUPPORTED_IDS[0]
        client = _FakeBedrockClient(errors={failing: _ClientErrorLike("ValidationException", "bad target")})
        _install_fake_bedrock(monkeypatch, client)

        payloads = _prompt_opts(_drain(oa._handle_optimize_prompt(_USER_ID, _SESSION_ID)))

        failing_kinds = [payload["kind"] for payload in payloads if payload.get("target_model_id") == failing]
        assert failing_kinds == ["invalid_target"]
        assert payloads[-1]["kind"] == "step_complete"

    def test_all_targets_failing_yields_step_failed(self, monkeypatch) -> None:
        """When every target fails, no optimized prompt is produced and the

        terminal flow event is `step_failed`.
        """
        client = _FakeBedrockClient(errors={target_id: RuntimeError("down") for target_id in _SUPPORTED_IDS})
        _install_fake_bedrock(monkeypatch, client)

        payloads = _prompt_opts(_drain(oa._handle_optimize_prompt(_USER_ID, _SESSION_ID)))

        assert not any(payload["kind"] == "optimized" for payload in payloads)
        assert payloads[-1]["kind"] == "step_failed"


# --- _handle_optimize_sample: reuses _handle_chatbot per side -------------


class _ChatbotSpy:
    """Async-generator stand-in for `_handle_chatbot`.

    Records the params of every call so the test can assert each side routes
    through the `mode="chatbot"` seam with the right `requested_model` /
    `system_prompt_override`, and streams a canned answer per call. A set of
    `fail_sessions` (matched by `session_id` suffix) makes a chosen side raise,
    to exercise per-side failure isolation.
    """

    def __init__(self, *, fail_suffixes: tuple[str, ...] = ()) -> None:
        self.calls: list[dict[str, Any]] = []
        self.fail_suffixes = fail_suffixes

    def __call__(
        self,
        query,
        user_id,
        session_id,
        requested_model="",
        system_prompt_override=None,
        mode="chatbot",
        **kwargs: Any,
    ):
        self.calls.append(
            {
                "query": query,
                "user_id": user_id,
                "session_id": session_id,
                "requested_model": requested_model,
                "system_prompt_override": system_prompt_override,
                "mode": mode,
            }
        )
        should_fail = any(session_id.endswith(suffix) for suffix in self.fail_suffixes)

        async def _gen():
            if should_fail:
                raise RuntimeError(f"invocation failed for {session_id}")
            # A heartbeat and a non-text event must be ignored by the runner;
            # only the `data` chunks become `sample` events.
            yield {"data": "", "heartbeat": True}
            yield {"message": {"role": "assistant"}}
            yield {"data": f"answer::{session_id}"}
            yield {"result": {"stop_reason": "end_turn"}}

        return _gen()


_CANDIDATE_INVOKE_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
_CANDIDATE_PROMPT = "You are a concise Trinity Reserve advisor. Answer crisply."
_CANDIDATE_LABEL = "Claude Haiku 4.5 · optimized prompt"


def _run_sample(spy: _ChatbotSpy) -> list[dict[str, Any]]:
    return _drain(
        oa._handle_optimize_sample(
            "What is my balance?",
            _USER_ID,
            _SESSION_ID,
            candidate_invoke_id=_CANDIDATE_INVOKE_ID,
            candidate_prompt=_CANDIDATE_PROMPT,
            candidate_label=_CANDIDATE_LABEL,
        )
    )


class TestOptimizeSampleRunsBothSides:
    """Req 7.1/7.2/7.4/13.2: baseline + candidate via _handle_chatbot only."""

    def test_invokes_chatbot_once_per_side_with_correct_params(self, monkeypatch) -> None:
        """Exactly two `_handle_chatbot` calls: baseline (`""` / `None`) then

        candidate (candidate invoke id / candidate prompt), both `mode="chatbot"`
        — the feature's only model-invocation seam (Req 13.2).
        """
        spy = _ChatbotSpy()
        monkeypatch.setattr(oa, "_handle_chatbot", spy)

        _run_sample(spy)

        assert len(spy.calls) == 2
        baseline, candidate = spy.calls
        assert baseline["requested_model"] == ""
        assert baseline["system_prompt_override"] is None
        assert candidate["requested_model"] == _CANDIDATE_INVOKE_ID
        assert candidate["system_prompt_override"] == _CANDIDATE_PROMPT
        assert {call["mode"] for call in spy.calls} == {"chatbot"}

    def test_uses_throwaway_session_suffixes(self, monkeypatch) -> None:
        """Both sides run under distinct throwaway session ids so the sample

        comparison never pollutes the live conversation memory (Req 12.4).
        """
        spy = _ChatbotSpy()
        monkeypatch.setattr(oa, "_handle_chatbot", spy)

        _run_sample(spy)

        session_ids = [call["session_id"] for call in spy.calls]
        assert session_ids == [f"{_SESSION_ID}-optbase", f"{_SESSION_ID}-optcand"]
        assert _SESSION_ID not in session_ids

    def test_answers_tagged_with_the_producing_variant(self, monkeypatch) -> None:
        """Each streamed answer is a `sample` event tagged with its variant;

        heartbeats and non-text events are not surfaced as answers.
        """
        spy = _ChatbotSpy()
        monkeypatch.setattr(oa, "_handle_chatbot", spy)

        payloads = _prompt_opts(_run_sample(spy))
        samples = [payload for payload in payloads if payload["kind"] == "sample"]

        assert len(samples) == 2
        baseline_sample, candidate_sample = samples
        assert baseline_sample["variant"] == "baseline"
        assert baseline_sample["text"] == f"answer::{_SESSION_ID}-optbase"
        assert candidate_sample["variant"] == "candidate"
        assert candidate_sample["text"] == f"answer::{_SESSION_ID}-optcand"
        assert candidate_sample["model_label"] == _CANDIDATE_LABEL


class TestOptimizeSampleFailureIsolation:
    """Req 7.6: a failure on one side still streams the other side."""

    def test_candidate_failure_still_streams_baseline(self, monkeypatch) -> None:
        """The candidate raising yields a `sample_error` for the candidate while

        the baseline answer still streams.
        """
        spy = _ChatbotSpy(fail_suffixes=("-optcand",))
        monkeypatch.setattr(oa, "_handle_chatbot", spy)

        payloads = _prompt_opts(_run_sample(spy))

        baseline_samples = [p for p in payloads if p["kind"] == "sample" and p["variant"] == "baseline"]
        candidate_errors = [p for p in payloads if p["kind"] == "sample_error" and p["variant"] == "candidate"]
        assert len(baseline_samples) == 1
        assert baseline_samples[0]["text"] == f"answer::{_SESSION_ID}-optbase"
        assert len(candidate_errors) == 1
        assert not any(p["kind"] == "sample" and p["variant"] == "candidate" for p in payloads)

    def test_baseline_failure_still_streams_candidate(self, monkeypatch) -> None:
        """The baseline raising yields a `sample_error` for the baseline while

        the candidate answer still streams (the other side is unaffected).
        """
        spy = _ChatbotSpy(fail_suffixes=("-optbase",))
        monkeypatch.setattr(oa, "_handle_chatbot", spy)

        payloads = _prompt_opts(_run_sample(spy))

        baseline_errors = [p for p in payloads if p["kind"] == "sample_error" and p["variant"] == "baseline"]
        candidate_samples = [p for p in payloads if p["kind"] == "sample" and p["variant"] == "candidate"]
        assert len(baseline_errors) == 1
        assert len(candidate_samples) == 1
        assert candidate_samples[0]["text"] == f"answer::{_SESSION_ID}-optcand"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
