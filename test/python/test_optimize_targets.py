"""Property-based tests for the prompt-optimization target validator and request
builder (`patterns/orchestrator-agent/optimize_targets.py`).

Covers two of the design's correctness properties for the prompt-optimization
showcase (see `.kiro/specs/prompt-optimization-showcase/design.md`). The module
under test is pure — no boto3, no I/O — so these run fully in-process with no
AWS and no deploy:

* **Property 1 — Optimization submits only supported foundation-model targets,
  never a profile id.** For any list of requested identifiers mixing supported
  foundation-model ids, inference-profile ids (including the Current_Model
  profile), unsupported ids, and duplicates, `validate_optimize_targets`
  returns a `submit` set that is a subset of the supported foundation-model
  ids, contains no inference-profile id, is de-duplicated, and has at most
  three entries — and every dropped inference-profile id is surfaced in
  `invalid` with reason `inference_profile`.

* **Property 2 — The OptimizePrompt request carries the current prompt text and
  a foundation-model target.** For any prompt text and any supported
  Target_Model, `build_optimize_request` produces a request whose
  `input.textPrompt.text` equals that exact prompt text and whose
  `targetModelId` equals the target's foundation-model id (never its
  invocable/profile `invoke_id`), one request per target.

Each property runs >= 100 Hypothesis examples.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st
from optimize_targets import (
    SUPPORTED_TARGET_MODELS,
    TargetModel,
    build_optimize_request,
    is_inference_profile_id,
    validate_optimize_targets,
)

# --- Shared vocabulary of identifiers for the generators -----------------

# Every supported foundation-model id (the only ids that may ever reach submit).
_SUPPORTED_FM_IDS: tuple[str, ...] = tuple(tm.optimize_target_id for tm in SUPPORTED_TARGET_MODELS)

# The Current_Model inference profile — MUST always be excluded from submit.
_CURRENT_MODEL_PROFILE = "us.anthropic.claude-sonnet-4-6"

# Inference-profile-form ids, including the Current_Model profile and every
# supported target's invocable `invoke_id` (the 4.5 targets invoke via a `us.`
# profile). All of these must be surfaced as invalid with reason
# "inference_profile" and never appear in submit.
_PROFILE_IDS: tuple[str, ...] = (
    _CURRENT_MODEL_PROFILE,
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "eu.anthropic.claude-3-sonnet-20240229-v1:0",
    "apac.amazon.nova-2-lite-v1:0",
)

# Unsupported, non-profile identifiers.
_UNSUPPORTED_IDS: tuple[str, ...] = (
    "anthropic.claude-instant-v1",
    "amazon.titan-text-express-v1",
    "meta.llama3-70b-instruct-v1:0",
    "cohere.command-r-v1:0",
    "",
)

_ALL_IDS: tuple[str, ...] = _SUPPORTED_FM_IDS + _PROFILE_IDS + _UNSUPPORTED_IDS


# --- Property 1 -----------------------------------------------------------


class TestProperty1SubmitOnlySupportedFoundationModels:
    """Feature: prompt-optimization-showcase, Property 1: Optimization submits
    only supported foundation-model targets, never a profile id."""

    @settings(max_examples=200, deadline=None)
    @given(requested=st.lists(st.sampled_from(_ALL_IDS), max_size=40))
    def test_submit_excludes_profiles_and_reports_them_invalid(self, requested: list[str]) -> None:
        """Feature: prompt-optimization-showcase, Property 1: Optimization
        submits only supported foundation-model targets, never a profile id.

        For any mix of supported FM ids, inference-profile ids (incl. the
        Current_Model profile), unsupported ids, and duplicates: submit holds no
        inference-profile id, submit is a subset of the supported FM ids, is
        de-duplicated, len <= 3, and every dropped profile id appears in invalid
        with reason "inference_profile".
        """
        result = validate_optimize_targets(requested)

        submit_ids = [tm.optimize_target_id for tm in result.submit]

        # submit is a subset of the supported foundation-model ids...
        assert set(submit_ids) <= set(_SUPPORTED_FM_IDS)
        # ...contains no inference-profile id (never a profile / invoke_id)...
        assert not any(is_inference_profile_id(mid) for mid in submit_ids)
        assert _CURRENT_MODEL_PROFILE not in submit_ids
        # ...is de-duplicated...
        assert len(submit_ids) == len(set(submit_ids))
        # ...and capped at three.
        assert len(submit_ids) <= 3

        # Every submitted entry is a genuine SUPPORTED_TARGET_MODELS registry entry.
        for tm in result.submit:
            assert tm in SUPPORTED_TARGET_MODELS

        # Every distinct profile id present in the request is reported invalid
        # with reason "inference_profile" and appears in no submit entry.
        invalid_profile_ids = {inv.id for inv in result.invalid if inv.reason == "inference_profile"}
        for mid in set(requested):
            if is_inference_profile_id(mid):
                assert mid in invalid_profile_ids
                assert mid not in submit_ids

        # Every invalid reason is one of the two defined reasons, and no id is
        # both submitted and invalid.
        invalid_ids = {inv.id for inv in result.invalid}
        assert all(inv.reason in {"inference_profile", "unsupported"} for inv in result.invalid)
        assert invalid_ids.isdisjoint(set(submit_ids))

    @settings(max_examples=150, deadline=None)
    @given(requested=st.lists(st.sampled_from(_UNSUPPORTED_IDS), max_size=20))
    def test_unsupported_non_profile_ids_reported_unsupported(self, requested: list[str]) -> None:
        """Feature: prompt-optimization-showcase, Property 1: Optimization
        submits only supported foundation-model targets, never a profile id.

        Unrecognized, non-profile identifiers never reach submit and are each
        surfaced as invalid with reason "unsupported".
        """
        result = validate_optimize_targets(requested)

        assert result.submit == []
        unsupported_ids = {inv.id for inv in result.invalid if inv.reason == "unsupported"}
        for mid in set(requested):
            assert mid in unsupported_ids


# --- Property 2 -----------------------------------------------------------


class TestProperty2RequestCarriesPromptTextAndFoundationModel:
    """Feature: prompt-optimization-showcase, Property 2: The OptimizePrompt
    request carries the current prompt text and a foundation-model target."""

    @settings(max_examples=200, deadline=None)
    @given(
        prompt_text=st.text(max_size=500),
        target=st.sampled_from(SUPPORTED_TARGET_MODELS),
    )
    def test_request_shape_uses_exact_text_and_fm_id(self, prompt_text: str, target: TargetModel) -> None:
        """Feature: prompt-optimization-showcase, Property 2: The OptimizePrompt
        request carries the current prompt text and a foundation-model target.

        input.textPrompt.text is the exact prompt text, and targetModelId is the
        target's foundation-model id — never its invocable/profile invoke_id.
        """
        request = build_optimize_request(prompt_text, target)

        assert request["input"]["textPrompt"]["text"] == prompt_text
        assert request["targetModelId"] == target.optimize_target_id
        # Never the invocable/profile form.
        if target.invoke_id != target.optimize_target_id:
            assert request["targetModelId"] != target.invoke_id
        # The submitted target id is never an inference-profile id.
        assert not is_inference_profile_id(request["targetModelId"])

    @settings(max_examples=150, deadline=None)
    @given(prompt_text=st.text(max_size=200))
    def test_one_request_planned_per_submitted_target(self, prompt_text: str) -> None:
        """Feature: prompt-optimization-showcase, Property 2: The OptimizePrompt
        request carries the current prompt text and a foundation-model target.

        Planning over the full supported set yields exactly one request per
        submitted target, each targeting that target's foundation-model id.
        """
        result = validate_optimize_targets(_SUPPORTED_FM_IDS)
        requests = [build_optimize_request(prompt_text, tm) for tm in result.submit]

        assert len(requests) == len(result.submit)
        planned_target_ids = [r["targetModelId"] for r in requests]
        assert planned_target_ids == [tm.optimize_target_id for tm in result.submit]
        # No duplicate targets planned.
        assert len(planned_target_ids) == len(set(planned_target_ids))
