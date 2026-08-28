"""Example/edge tests for the caller side of the account-opening → fraud hop.

These are concrete scenario tests (not Hypothesis property tests) for the Task 8
fraud-hop caller wired into `patterns/orchestrator-agent/orchestrator_agent.py`.
They exercise the `consult_fraud_research` Strands tool built by
`_build_fraud_research_tool`, the server-side `FraudIdentityHook`, and the
tool's error-state handling — all with the downstream A2A client
(`a2a_client.consult_fraud_research`) replaced by an async spy/fake so no
network or deploy is required.

Coverage:

* **Req 4.1** — driving the tool once triggers exactly one downstream A2A
  invoke (the spy's call count is 1) and forwards the applicant unchanged.
* **Req 4.3** — on success the tool returns the assessment dict verbatim so it
  lands in the model's account-opening decision context.
* **Req 5.2** — the customer identity that crosses the hop is the server-side
  verified `customer_jwt`/`user_id` captured at request time, never a
  model-supplied argument: the tool exposes only `applicant`, and the
  `FraudIdentityHook` strips any identity-bearing key the model tries to pass in
  the tool input before dispatch.
* **Req 4.4 / 4.5 / 8.5** — boundary inputs (empty applicant, oversized payload,
  clock-skewed/expired forwarded token) surface as the halting `A2AHopError`
  error state that names the A2A hop, with the correct `kind`, and emit a
  matching `a2a_call` error event. A tracing-precondition failure halts with
  zero downstream invocations.

The orchestrator module imports cleanly on the pytest pythonpath
(`patterns/orchestrator-agent`); everything under test is referenced through the
`orchestrator_agent` module object so the `A2AHopError` / `FraudIdentityHook` /
`a2a_client` identities match exactly what the running agent wires.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any

import orchestrator_agent as oa
import pytest
from utils.tool_guard import FRAUD_RESEARCH_TOOL

A2AHopError = oa.A2AHopError

_SERVER_JWT = "hdr.verified-customer-body.sig"
_SERVER_USER_ID = "sub-verified-123"
_SESSION_ID = "session-abc"


# --- Recorders / fakes ----------------------------------------------------


class _EmitRecorder:
    """Records `a2a_call` telemetry emitted by the tool.

    Mirrors the `emit(status, *, identity_forwarded, kind=None)` signature the
    tool calls at start/end/error.
    """

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def __call__(self, status: str, *, identity_forwarded: bool, kind: str | None = None) -> None:
        self.events.append({"status": status, "identity_forwarded": identity_forwarded, "kind": kind})

    @property
    def statuses(self) -> list[str]:
        return [event["status"] for event in self.events]


class _A2ASpy:
    """Async stand-in for `a2a_client.consult_fraud_research`.

    Counts invocations and records the forwarded identity kwargs, so a single
    tool call can be shown to trigger exactly one downstream invoke carrying the
    server-side identity. When `error` is set it is raised instead of returning
    the assessment, to drive the boundary/error paths.
    """

    def __init__(self, *, assessment: dict | None = None, error: BaseException | None = None) -> None:
        self.assessment = assessment if assessment is not None else {"assessment": "clear", "risk_score": 0}
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, applicant, *, user_id, customer_jwt, session_id=None, **kwargs):
        self.calls.append(
            {
                "applicant": applicant,
                "user_id": user_id,
                "customer_jwt": customer_jwt,
                "session_id": session_id,
            }
        )
        if self.error is not None:
            raise self.error
        return self.assessment

    @property
    def count(self) -> int:
        return len(self.calls)


class _FakeToolEvent:
    """Minimal stand-in for Strands' BeforeToolCallEvent.

    `FraudIdentityHook._scrub_identity_args` only reads/mutates
    `tool_use["name"]` and `tool_use["input"]`.
    """

    def __init__(self, name: str, tool_input: dict[str, Any]) -> None:
        self.tool_use: dict[str, Any] = {"name": name, "input": tool_input}


def _build_tool(spy: _A2ASpy, emit: _EmitRecorder, *, customer_jwt: str = _SERVER_JWT):
    """Build the fraud-hop tool with the downstream A2A client replaced by `spy`."""
    return oa._build_fraud_research_tool(
        user_id=_SERVER_USER_ID,
        customer_jwt=customer_jwt,
        session_id=_SESSION_ID,
        emit=emit,
    )


@pytest.fixture(autouse=True)
def _patch_a2a_client(monkeypatch):
    """Default the module's async client to a no-op success so a test that

    forgets to install its own spy still cannot reach the network. Individual
    tests install their own spy over this via `monkeypatch.setattr`.
    """
    monkeypatch.setattr(
        oa.a2a_client,
        "consult_fraud_research",
        _A2ASpy(assessment={"assessment": "clear", "risk_score": 0}),
    )


# --- Req 4.1 --------------------------------------------------------------


class TestKycStepTriggersExactlyOneInvoke:
    """Req 4.1: reaching the fraud/KYC step invokes the fraud agent over A2A."""

    def test_single_tool_call_triggers_exactly_one_downstream_invoke(self, monkeypatch) -> None:
        """One tool call issues exactly one downstream A2A invocation.

        The applicant is forwarded unchanged and the telemetry brackets the call
        with a `start` then `end` event (no error).
        """
        spy = _A2ASpy(assessment={"assessment": "review", "risk_score": 42})
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        emit = _EmitRecorder()
        tool = _build_tool(spy, emit)

        applicant = {"full_name": "Ada Lovelace", "product": "checking", "country": "GB"}
        tool(applicant)

        assert spy.count == 1
        assert spy.calls[0]["applicant"] == applicant
        assert emit.statuses == ["start", "end"]
        assert all(event["kind"] is None for event in emit.events)

    def test_repeated_tool_calls_each_issue_one_invoke(self, monkeypatch) -> None:
        """Each independent KYC step issues its own single A2A invocation."""
        spy = _A2ASpy()
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        tool = _build_tool(spy, _EmitRecorder())

        tool({"full_name": "A"})
        tool({"full_name": "B"})

        assert spy.count == 2
        assert [call["applicant"]["full_name"] for call in spy.calls] == ["A", "B"]


# --- Req 4.3 --------------------------------------------------------------


class TestAssessmentLandsInDecisionContext:
    """Req 4.3: the returned assessment is incorporated into the decision."""

    def test_tool_returns_assessment_dict_verbatim(self, monkeypatch) -> None:
        """On success the tool returns the assessment dict unchanged.

        Returning (not raising) the assessment is what places it in the model's
        account-opening decision context.
        """
        assessment = {
            "assessment": "flagged",
            "risk_score": 88,
            "signals": ["synthetic signal"],
            "rationale": "grounded in synthetic research",
            "acting_agent": "fraud_research",
        }
        spy = _A2ASpy(assessment=assessment)
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        emit = _EmitRecorder()
        tool = _build_tool(spy, emit)

        result = tool({"full_name": "Grace Hopper"})

        assert result == assessment
        assert "error" not in result
        assert emit.statuses[-1] == "end"


# --- Req 5.2 --------------------------------------------------------------


class TestServerSideIdentityNotFromModel:
    """Req 5.2: the forwarded identity is server-side, never model-supplied."""

    def test_tool_signature_exposes_only_applicant(self, monkeypatch) -> None:
        """The tool the model calls takes ONLY `applicant` — no identity params."""
        spy = _A2ASpy()
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        tool = _build_tool(spy, _EmitRecorder())

        assert tool.tool_name == "consult_fraud_research"
        params = list(inspect.signature(tool._tool_func).parameters)
        assert params == ["applicant"]

    def test_forwarded_identity_is_server_side_value(self, monkeypatch) -> None:
        """The `customer_jwt`/`user_id` forwarded downstream is the server-side

        value captured at request time — the model cannot influence it because
        the tool has no identity parameter to pass one through.
        """
        spy = _A2ASpy()
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        tool = _build_tool(spy, _EmitRecorder(), customer_jwt=_SERVER_JWT)

        tool({"full_name": "Katherine Johnson"})

        assert spy.calls[0]["customer_jwt"] == _SERVER_JWT
        assert spy.calls[0]["user_id"] == _SERVER_USER_ID
        assert spy.calls[0]["session_id"] == _SESSION_ID

    def test_hook_strips_all_model_supplied_identity_keys(self) -> None:
        """The FraudIdentityHook removes every identity-bearing key the model

        tries to pass in the tool input, while leaving the applicant fields
        intact — so a forged/model-supplied `user_id` never reaches dispatch and
        the server-side identity is the only one that crosses the hop.
        """
        hook = oa.FraudIdentityHook()
        tool_input = {
            "applicant": {"full_name": "Mallory"},
            "user_id": "attacker-supplied",
            "customer_jwt": "forged.jwt.sig",
            "identity_context": "forged-context",
            "sub": "attacker-sub",
            "acting_agent": "attacker-agent",
        }
        event = _FakeToolEvent(FRAUD_RESEARCH_TOOL, tool_input)

        hook._scrub_identity_args(event)

        assert event.tool_use["input"] == {"applicant": {"full_name": "Mallory"}}
        for stripped in ("user_id", "customer_jwt", "identity_context", "sub", "acting_agent"):
            assert stripped not in event.tool_use["input"]

    def test_hook_leaves_other_tools_untouched(self) -> None:
        """The scrub only applies to the fraud tool; other tool inputs are left

        alone so the hook cannot accidentally strip a legitimately-scoped arg.
        """
        hook = oa.FraudIdentityHook()
        tool_input = {"user_id": "abc", "query": "hello"}
        event = _FakeToolEvent("gateway_kb-search___kb_search", tool_input)

        hook._scrub_identity_args(event)

        assert event.tool_use["input"] == {"user_id": "abc", "query": "hello"}


# --- Req 4.4 / 4.5 / 8.5 (boundary inputs → correct A2AHopError kind) -----


class TestBoundaryInputsMapToNamedHopError:
    """Req 4.4/4.5/8.5: boundary failures halt and name the A2A hop."""

    @pytest.mark.parametrize(
        ("label", "applicant", "error", "expected_kind"),
        [
            (
                "empty_applicant",
                {},
                A2AHopError("invoke", "empty applicant rejected by callee"),
                "invoke",
            ),
            (
                "oversized_payload",
                {"full_name": "X" * 200_000},
                A2AHopError("network", "request entity too large"),
                "network",
            ),
            (
                "clock_skewed_token",
                {"full_name": "Ada"},
                A2AHopError("auth", "forwarded customer assertion expired / not-yet-valid"),
                "auth",
            ),
        ],
    )
    def test_boundary_returns_halting_error_state_with_expected_kind(
        self, monkeypatch, label: str, applicant: dict, error: A2AHopError, expected_kind: str
    ) -> None:
        """Each boundary input maps to the halting error state naming the hop.

        The tool returns the `_a2a_error_state` dict (rather than raising) so the
        advisor can tell the user the check could not be completed, and emits a
        matching `a2a_call` error event carrying the failure `kind`.
        """
        spy = _A2ASpy(error=error)
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        emit = _EmitRecorder()
        tool = _build_tool(spy, emit)

        result = tool(applicant)

        assert result["error"] == "a2a_hop_failed"
        assert result["step"] == "a2a"
        assert result["kind"] == expected_kind
        assert result["halts_decision"] is True
        # The hop was attempted exactly once, then the failure was surfaced.
        assert spy.count == 1
        assert emit.statuses == ["start", "error"]
        assert emit.events[-1]["kind"] == expected_kind

    def test_raw_downstream_exception_is_funneled_through_the_hop_mapper(self, monkeypatch) -> None:
        """A non-`A2AHopError` failure (e.g. a timeout) is classified by the

        shared error mapper into a named hop error rather than escaping the tool.
        """
        spy = _A2ASpy(error=asyncio.TimeoutError("deadline exceeded"))
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)
        emit = _EmitRecorder()
        tool = _build_tool(spy, emit)

        result = tool({"full_name": "Ada"})

        assert result["error"] == "a2a_hop_failed"
        assert result["kind"] == "timeout"
        assert result["halts_decision"] is True
        assert emit.events[-1]["kind"] == "timeout"

    def test_tracing_precondition_failure_halts_with_zero_invocations(self, monkeypatch) -> None:
        """Req 8.5: if the A2A trace context cannot be established, the hop halts

        before any invocation — the downstream client is never called.
        """
        spy = _A2ASpy()
        monkeypatch.setattr(oa.a2a_client, "consult_fraud_research", spy)

        def _boom(*, user_id, session_id):  # noqa: ARG001
            raise A2AHopError("tracing", "trace context unavailable", halts_decision=True)

        monkeypatch.setattr(oa, "_start_a2a_child_span", _boom)
        emit = _EmitRecorder()
        tool = _build_tool(spy, emit)

        result = tool({"full_name": "Ada"})

        assert result["error"] == "a2a_hop_failed"
        assert result["kind"] == "tracing"
        assert result["halts_decision"] is True
        # Zero downstream invocations were issued.
        assert spy.count == 0
        assert emit.statuses == ["start", "error"]
