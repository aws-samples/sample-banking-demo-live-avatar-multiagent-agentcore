"""Property-based tests for the caller-side A2A client.

Covers four of the design's correctness properties for the account-opening →
fraud-research hop. The
pure logic seams in `patterns/utils/a2a_client.py` are exercised with a fake
Strands `A2AAgent` and a fake card fetcher that record call order/timestamps,
so no network or deploy is required:

* **Property 1 — Agent card is well-formed and discoverable.** Serializing a
  parsed `AgentCard` and parsing it back yields an equivalent document with a
  non-empty `name`/`url` and at least one skill, and `endpoint_from_card`
  returns that same `url`.

* **Property 2 — Discovery precedes invocation.** `consult_fraud_research`
  fetches the agent card strictly before it issues any `message/send`, and the
  endpoint it invokes is the discovered card's `url` — never the static runtime
  invocation URL.

* **Property 3 — An unrecoverable A2A precondition or failure halts the
  dependent decision and names the hop.** Each failure mode
  (discovery/invoke/timeout/network/auth/tracing) maps to an
  `A2AHopError(step="a2a")` with the right `kind`, `halts_decision=True`, no
  success result, and zero invocations for discovery/precondition failures.

* **Property 4 — The A2A request carries the applicant details and a bearer
  credential.** For any synthetic applicant, the built request carries every
  applicant field and a non-empty `Authorization` bearer.

Async composed operations are driven with `asyncio.run` per example (a fresh
event loop each time), matching the convention in the rest of this suite. Each
property runs >= 100 Hypothesis examples.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass

import pytest
from a2a_client import (
    A2A_ERROR_KINDS,
    A2ADiscoveryError,
    A2AHopError,
    AgentCard,
    build_a2a_message,
    build_a2a_request,
    consult_fraud_research,
    endpoint_from_card,
    map_error_to_hop,
    runtime_invocation_url,
)
from hypothesis import given, settings
from hypothesis import strategies as st
from identity_context import IDENTITY_CONTEXT_KEY, build_identity_context

# --- Shared strategies ----------------------------------------------------

_NON_BLANK = st.text(min_size=1, max_size=40).filter(lambda s: s.strip() != "")

# Card URLs use a distinct host so they are provably different from the static
# runtime invocation URL — this is what lets Property 2 assert the invoked
# endpoint comes from the discovered card and never a hardcoded value.
_CARD_URLS = st.builds(
    lambda seg: f"https://card-{seg}.example/runtimes/invocations/",
    st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=16),
)

_SKILLS = st.lists(
    st.fixed_dictionaries(
        {
            "id": st.text(min_size=1, max_size=20).filter(lambda s: s.strip() != ""),
            "name": st.text(min_size=1, max_size=20).filter(lambda s: s.strip() != ""),
        }
    ),
    min_size=1,
    max_size=3,
)

_ARN = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/fraud-research-abc"
_REGION = "us-east-1"


@st.composite
def _card_dicts(draw: st.DrawFn) -> dict:
    """Generate a valid wire-shaped agent-card document (camelCase keys)."""
    return {
        "name": draw(_NON_BLANK),
        "url": draw(_CARD_URLS),
        "description": draw(st.text(max_size=50)),
        "version": draw(st.sampled_from(["1.0.0", "0.1.0", "2.3.1"])),
        "protocolVersion": "0.3.0",
        "preferredTransport": "JSONRPC",
        "capabilities": {"streaming": draw(st.booleans())},
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "skills": draw(_SKILLS),
    }


_APPLICANT_VALUES = st.one_of(
    st.text(max_size=30),
    st.integers(min_value=-10_000, max_value=1_000_000),
    st.booleans(),
)


@st.composite
def _applicants(draw: st.DrawFn) -> dict:
    """Generate a synthetic applicant: required base fields plus a few extras."""
    base = {
        "full_name": draw(st.text(min_size=1, max_size=30).filter(lambda s: s.strip() != "")),
        "date_of_birth": draw(st.text(min_size=1, max_size=12).filter(lambda s: s.strip() != "")),
        "country": draw(st.sampled_from(["US", "GB", "DE", "JP", "BR"])),
        "declared_income": draw(st.integers(min_value=0, max_value=1_000_000)),
    }
    extras = draw(
        st.dictionaries(
            st.text(min_size=1, max_size=12).filter(lambda s: s.strip() != "" and s not in base),
            _APPLICANT_VALUES,
            max_size=4,
        )
    )
    return {**base, **extras}


# A raw (unverified) JWT-ish string. build_identity_context does not verify it;
# any non-blank string is a valid forwarded assertion for these seams.
_JWTS = st.text(min_size=1, max_size=60).filter(lambda s: s.strip() != "")
_BEARERS = st.text(min_size=1, max_size=40).filter(lambda s: s.strip() != "")


def _run(coro):
    """Drive a coroutine to completion on a fresh event loop (per example)."""
    return asyncio.run(coro)


# --- Fake A2A client that records call order/timestamps -------------------


@dataclass
class _RecordedCall:
    seq: int
    method: str  # "get_agent_card" | "invoke"
    endpoint: str


class _CallLog:
    """Records every fake-client call in issue order, tagged by endpoint."""

    def __init__(self) -> None:
        self.calls: list[_RecordedCall] = []
        self._n = 0
        self.last_prompt = None

    def record(self, method: str, endpoint: str) -> None:
        self.calls.append(_RecordedCall(self._n, method, endpoint))
        self._n += 1

    @property
    def methods(self) -> list[str]:
        return [c.method for c in self.calls]

    def endpoints_for(self, method: str) -> list[str]:
        return [c.endpoint for c in self.calls if c.method == method]


class _FakeA2AAgent:
    """Fake Strands `A2AAgent` implementing the injectable `A2AClient` seam.

    Records the order/endpoint of `get_agent_card` and `invoke_async`, and can
    be told to raise a chosen exception from either method to inject failures.
    """

    def __init__(
        self,
        endpoint: str,
        *,
        bearer: str,
        log: _CallLog,
        card_dict: dict,
        invoke_result,
        get_card_error: BaseException | None,
        invoke_error: BaseException | None,
    ) -> None:
        self._endpoint = endpoint
        self.bearer = bearer
        self._log = log
        self._card_dict = card_dict
        self._invoke_result = invoke_result
        self._get_card_error = get_card_error
        self._invoke_error = invoke_error

    async def get_agent_card(self):
        self._log.record("get_agent_card", self._endpoint)
        if self._get_card_error is not None:
            raise self._get_card_error
        return self._card_dict

    async def invoke_async(self, prompt):
        self._log.record("invoke", self._endpoint)
        self._log.last_prompt = prompt
        if self._invoke_error is not None:
            raise self._invoke_error
        return self._invoke_result


def _factory(
    log: _CallLog,
    *,
    card_dict: dict,
    invoke_result=None,
    get_card_error: BaseException | None = None,
    invoke_error: BaseException | None = None,
):
    """Build an `agent_factory` closure that yields recording fake clients."""

    def build(endpoint: str, *, bearer: str, timeout: int = 300) -> _FakeA2AAgent:
        return _FakeA2AAgent(
            endpoint,
            bearer=bearer,
            log=log,
            card_dict=card_dict,
            invoke_result=invoke_result,
            get_card_error=get_card_error,
            invoke_error=invoke_error,
        )

    return build


def _ok_result() -> str:
    """A JSON assessment artifact the client parses into `result.data`."""
    return json.dumps({"assessment": "clear", "risk_score": 0, "signals": [], "acting_agent": "fraud_research"})


class _HttpStatusError(Exception):
    """Exception carrying an HTTP status code (mimics a transport 401/403)."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Property 1 -----------------------------------------------------------


class TestProperty1AgentCardWellFormed:
    """Feature: a2a-agent-collaboration, Property 1: Agent card is well-formed
    and discoverable."""

    @settings(max_examples=200, deadline=None)
    @given(card_dict=_card_dicts())
    def test_card_round_trips_and_endpoint_extraction(self, card_dict: dict) -> None:
        """Feature: a2a-agent-collaboration, Property 1: Agent card is
        well-formed and discoverable.

        Parsing the card, serializing it, and parsing it again yields an
        equivalent `AgentCard`; the card has a non-empty name/url and >= 1
        skill; and endpoint extraction returns the card's `url`.
        """
        card = AgentCard.from_dict(card_dict)
        round_tripped = AgentCard.from_dict(card.to_dict())

        assert round_tripped == card
        assert card.name.strip() != ""
        assert card.url.strip() != ""
        assert len(card.skills) >= 1
        assert endpoint_from_card(card) == card.url
        assert endpoint_from_card(round_tripped) == card.url

    def test_from_dict_rejects_cards_missing_required_fields(self) -> None:
        """Feature: a2a-agent-collaboration, Property 1: Agent card is
        well-formed and discoverable (invalid cards are rejected).

        A card missing name/url or declaring no skill is a discovery failure.
        """
        base = {"name": "n", "url": "https://x.example/", "skills": [{"id": "s"}]}
        for bad in (
            {**base, "name": ""},
            {**base, "url": ""},
            {**base, "skills": []},
        ):
            with pytest.raises(A2ADiscoveryError):
                AgentCard.from_dict(bad)


# --- Property 2 -----------------------------------------------------------


class TestProperty2DiscoveryPrecedesInvocation:
    """Feature: a2a-agent-collaboration, Property 2: Discovery precedes
    invocation."""

    @settings(max_examples=150, deadline=None)
    @given(card_dict=_card_dicts(), applicant=_applicants(), jwt=_JWTS)
    def test_discovery_strictly_before_invoke_and_endpoint_from_card(
        self, card_dict: dict, applicant: dict, jwt: str
    ) -> None:
        """Feature: a2a-agent-collaboration, Property 2: Discovery precedes
        invocation.

        The agent card is fetched strictly before any `message/send`, and the
        invoked endpoint is the discovered card's `url`, never the static
        runtime invocation URL.
        """
        log = _CallLog()
        factory = _factory(log, card_dict=card_dict, invoke_result=_ok_result())

        result = _run(
            consult_fraud_research(
                applicant,
                user_id="sub-1",
                customer_jwt=jwt,
                runtime_arn=_ARN,
                bearer="machine-token",
                region=_REGION,
                agent_factory=factory,
            )
        )

        assert isinstance(result, dict)

        # Both steps happened, discovery strictly first.
        assert "get_agent_card" in log.methods
        assert "invoke" in log.methods
        first_invoke = log.methods.index("invoke")
        first_discovery = log.methods.index("get_agent_card")
        assert first_discovery < first_invoke
        # Nothing but discovery is issued before the first invocation.
        assert all(call.method == "get_agent_card" for call in log.calls[:first_invoke])

        # The invoked endpoint is the discovered card url — not the static URL.
        static_url = runtime_invocation_url(_ARN, region=_REGION)
        invoke_endpoints = log.endpoints_for("invoke")
        assert invoke_endpoints
        assert all(ep == card_dict["url"] for ep in invoke_endpoints)
        assert all(ep != static_url for ep in invoke_endpoints)
        # Discovery, by contrast, goes through the static runtime URL.
        assert log.endpoints_for("get_agent_card") == [static_url]


# --- Property 3 -----------------------------------------------------------


class TestProperty3FailureHaltsAndNamesHop:
    """Feature: a2a-agent-collaboration, Property 3: An unrecoverable A2A
    precondition or failure halts the dependent decision and names the hop."""

    def _consult(self, factory, **overrides):
        kwargs = dict(
            user_id="sub-1",
            customer_jwt="hdr.body.sig",
            runtime_arn=_ARN,
            bearer="machine-token",
            region=_REGION,
            agent_factory=factory,
        )
        kwargs.update(overrides)
        applicant = kwargs.pop("applicant", {"full_name": "Ada"})
        return _run(consult_fraud_research(applicant, **kwargs))

    @settings(max_examples=100, deadline=None)
    @given(applicant=_applicants(), card_dict=_card_dicts())
    def test_discovery_failure_halts_with_zero_invocations(self, applicant: dict, card_dict: dict) -> None:
        """Feature: a2a-agent-collaboration, Property 3: An unrecoverable A2A
        precondition or failure halts the dependent decision and names the hop
        (discovery failure).
        """
        log = _CallLog()
        factory = _factory(
            log,
            card_dict=card_dict,
            get_card_error=A2ADiscoveryError("card unreachable"),
        )
        with pytest.raises(A2AHopError) as exc_info:
            self._consult(factory, applicant=applicant)

        err = exc_info.value
        assert err.step == "a2a"
        assert err.kind == "discovery"
        assert err.halts_decision is True
        # Discovery was attempted; zero invocations were issued.
        assert "invoke" not in log.methods

    @settings(max_examples=100, deadline=None)
    @given(
        applicant=_applicants(),
        card_dict=_card_dicts(),
        failure=st.sampled_from(["invoke", "timeout", "network", "auth"]),
    )
    def test_invoke_failure_modes_map_to_named_hop(self, applicant: dict, card_dict: dict, failure: str) -> None:
        """Feature: a2a-agent-collaboration, Property 3: An unrecoverable A2A
        precondition or failure halts the dependent decision and names the hop
        (invoke / timeout / network / auth).
        """
        errors = {
            "invoke": RuntimeError("assessment executor exploded"),
            "timeout": asyncio.TimeoutError("deadline exceeded"),
            "network": ConnectionError("network is unreachable"),
            "auth": _HttpStatusError("unauthorized", status_code=401),
        }
        log = _CallLog()
        factory = _factory(log, card_dict=card_dict, invoke_error=errors[failure])

        with pytest.raises(A2AHopError) as exc_info:
            self._consult(factory, applicant=applicant)

        err = exc_info.value
        assert err.step == "a2a"
        assert err.kind == failure
        assert err.kind in A2A_ERROR_KINDS
        assert err.halts_decision is True
        # Discovery succeeded and exactly one invocation was attempted.
        assert log.methods.count("get_agent_card") == 1
        assert log.methods.count("invoke") == 1

    @settings(max_examples=100, deadline=None)
    @given(applicant=_applicants(), card_dict=_card_dicts())
    def test_missing_runtime_arn_precondition_issues_nothing(self, applicant: dict, card_dict: dict) -> None:
        """Feature: a2a-agent-collaboration, Property 3: An unrecoverable A2A
        precondition or failure halts the dependent decision and names the hop
        (missing runtime ARN — invocation cannot occur, Req 4.5).
        """
        log = _CallLog()
        factory = _factory(log, card_dict=card_dict, invoke_result=_ok_result())

        with pytest.raises(A2AHopError) as exc_info:
            self._consult(factory, applicant=applicant, runtime_arn="")

        err = exc_info.value
        assert err.step == "a2a"
        assert err.kind == "invoke"
        assert err.halts_decision is True
        # Precondition failed before discovery: zero discovery, zero invoke.
        assert log.calls == []

    @settings(max_examples=100, deadline=None)
    @given(applicant=_applicants(), card_dict=_card_dicts())
    def test_missing_customer_assertion_precondition_issues_nothing(self, applicant: dict, card_dict: dict) -> None:
        """Feature: a2a-agent-collaboration, Property 3: An unrecoverable A2A
        precondition or failure halts the dependent decision and names the hop
        (missing verified customer assertion, Req 5.4).
        """
        log = _CallLog()
        factory = _factory(log, card_dict=card_dict, invoke_result=_ok_result())

        with pytest.raises(A2AHopError) as exc_info:
            self._consult(factory, applicant=applicant, customer_jwt="")

        err = exc_info.value
        assert err.step == "a2a"
        assert err.kind == "auth"
        assert err.halts_decision is True
        assert log.calls == []

    @settings(max_examples=100, deadline=None)
    @given(detail=st.text(max_size=40))
    def test_tracing_failure_names_hop_and_halts(self, detail: str) -> None:
        """Feature: a2a-agent-collaboration, Property 3: An unrecoverable A2A
        precondition or failure halts the dependent decision and names the hop
        (tracing capture failure blocks the hop, Req 8.5).

        A tracing-capture failure that blocks the hop is raised as
        `A2AHopError(kind="tracing", halts_decision=True)` and funnels through
        the shared error mapper unchanged.
        """
        raised = A2AHopError("tracing", detail or "trace context unavailable", halts_decision=True)
        mapped = map_error_to_hop(raised)

        assert mapped is raised
        assert mapped.step == "a2a"
        assert mapped.kind == "tracing"
        assert mapped.kind in A2A_ERROR_KINDS
        assert mapped.halts_decision is True


# --- Property 4 -----------------------------------------------------------


class TestProperty4RequestCarriesApplicantAndBearer:
    """Feature: a2a-agent-collaboration, Property 4: The A2A request carries the
    applicant details and a bearer credential."""

    @settings(max_examples=200, deadline=None)
    @given(applicant=_applicants(), card_dict=_card_dicts(), bearer=_BEARERS, jwt=_JWTS)
    def test_request_carries_applicant_fields_and_nonempty_bearer(
        self, applicant: dict, card_dict: dict, bearer: str, jwt: str
    ) -> None:
        """Feature: a2a-agent-collaboration, Property 4: The A2A request carries
        the applicant details and a bearer credential.

        Every applicant field survives into the request message, and the
        transport headers carry a non-empty `Authorization` bearer.
        """
        card = AgentCard.from_dict(card_dict)
        identity_context = build_identity_context(jwt)
        message = build_a2a_message(applicant)

        request = build_a2a_request(
            card,
            message,
            bearer=bearer,
            identity_context=identity_context,
            session_id="session-xyz",
        )

        # Applicant details crossed the hop intact.
        text = request.message["parts"][0]["text"]
        marker = "Applicant: "
        parsed = json.loads(text[text.index(marker) + len(marker) :])
        assert parsed == json.loads(json.dumps(applicant, sort_keys=True, default=str))
        for required in ("full_name", "date_of_birth", "country", "declared_income"):
            assert required in parsed

        # A non-empty Authorization bearer authenticates the calling agent.
        auth_header = request.headers["Authorization"]
        assert auth_header == f"Bearer {bearer}"
        assert auth_header.removeprefix("Bearer ").strip() != ""

        # The verified customer assertion is forwarded in the message metadata.
        assert request.message["metadata"][IDENTITY_CONTEXT_KEY] == jwt

    @settings(max_examples=100, deadline=None)
    @given(applicant=_applicants(), card_dict=_card_dicts(), jwt=_JWTS, blank=st.sampled_from(["", "   ", "\n"]))
    def test_empty_bearer_is_rejected_as_auth_error(
        self, applicant: dict, card_dict: dict, jwt: str, blank: str
    ) -> None:
        """Feature: a2a-agent-collaboration, Property 4: The A2A request carries
        the applicant details and a bearer credential (a blank bearer is
        rejected — a request is never built without a caller credential).
        """
        card = AgentCard.from_dict(card_dict)
        message = build_a2a_message(applicant)

        with pytest.raises(A2AHopError) as exc_info:
            build_a2a_request(
                card,
                message,
                bearer=blank,
                identity_context=build_identity_context(jwt),
            )
        assert exc_info.value.kind == "auth"
