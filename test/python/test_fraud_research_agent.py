"""Property-based tests for the fraud-research A2A server handler.

Covers seven of the design's correctness properties for the callee side of the
account-opening → fraud-research hop. The pure gating/handler seams
in `patterns/fraud-research-agent/fraud_research_agent.py` are exercised with the
model and the Gateway MCP client mocked, so no network or deploy is required:

* **Property 6 — The callee propagates one identity and both owners across the
  hop.** A valid customer assertion binds the verified `sub` as the injected
  Gateway `user_id` (via the wired `UserScopeHook`), the callee span attributes
  carry that `sub` under owner `fraud_research`, and the caller-side identity
  context names the same `sub` under owner `ai_agent`.

* **Property 7 — The callee rejects requests lacking a verified identity.** A
  missing / malformed / expired / bad-signature `identity_context` makes the
  executor raise a JSON-RPC authorization error before the assessment runs
  (the injected token/client/model factories are never invoked).

* **Property 8 — The callee rejects unauthorized capabilities.** Any method or
  skill other than the single advertised `fraud_research_assessment` is
  rejected before the assessment runs.

* **Property 9 — The fraud agent calls the Gateway as a distinct principal.**
  `fraud_gateway_access_token` mints its token with the fraud agent's own OAuth
  client parameter, distinct from the shared machine client.

* **Property 10 — A model call is blocked when its guardrail cannot be
  applied.** When the guardrail config is unavailable the executor raises before
  building the model, so the model call is never issued.

* **Property 11 — The assessment result is well-formed.** For any (mocked) model
  output over a synthetic applicant, `build_assessment_artifact` returns a
  schema-valid assessment with the verified customer `sub` and acting-agent id.

* **Property 12 — Concurrent users never cross identities.** Two concurrently
  processed requests with distinct `sub` values each bind their own `sub` as the
  injected Gateway `user_id`; no identity bleeds from one request into the other.

RSA key material is generated once at import (key generation is expensive) and
reused across examples; only signing happens per example. `verify_user_pool_jwt`
is pointed at a local JWKS stand-in so the real verification path runs for real
— only the network key fetch is replaced (the same pattern as
`test_a2a_identity_context.py`). Each property runs >= 100 Hypothesis examples.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
from typing import Any

import fraud_research_agent as fra
import jwt as pyjwt
import pytest

# Import the SAME module objects the handler imports. `patterns/utils` and
# `patterns` are both on the pytest pythonpath, so a bare `import auth` would
# bind a *different* module object (and different `IdentityVerificationError`
# / `UserScopeHook` classes) than the handler's `from utils.auth import ...`.
# Using the `utils.*` paths keeps class identity aligned so `isinstance` and
# `except IdentityVerificationError` match across the boundary.
import utils.auth as auth
from a2a.utils.errors import ServerError
from agent_card import FRAUD_RESEARCH_SKILL_ID
from cryptography.hazmat.primitives.asymmetric import rsa
from fraud_research_agent import (
    ACTING_AGENT_ID,
    VALID_ASSESSMENTS,
    FraudRequestRejected,
    FraudResearchExecutor,
    GuardrailUnavailableError,
    build_assessment_artifact,
    ensure_guardrail_config,
    fraud_gateway_access_token,
    validate_requested_skill,
    verify_request_identity,
)
from hypothesis import assume, given, settings
from hypothesis import strategies as st
from strands import tool
from strands.hooks import BeforeToolCallEvent
from strands.multiagent.a2a.executor import StrandsA2AExecutor
from utils.identity_context import (
    ACTING_AGENT_KEY,
    DEFAULT_ACTING_AGENT,
    build_identity_context,
    read_acting_agent,
    read_identity_context,
)
from utils.tool_guard import UserScopeHook

# --- Local RSA key material + JWKS stand-in -------------------------------

# Generated once — RSA key generation is far too slow to run per Hypothesis
# example. SIGNING_KEY backs the fixture JWKS; WRONG_KEY is an unrelated key
# used to forge bad-signature tokens the verifier must reject.
SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
SIGNING_PUBLIC_KEY = SIGNING_KEY.public_key()
WRONG_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

TEST_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool"

# A guardrail config the tests treat as "available".
_GUARDRAIL_OK = {"guardrailIdentifier": "gr-test", "guardrailVersion": "1"}

# A registered scoped tool name exactly as the gateway registers it, and an
# unscoped one — the hook must inject into the former and leave the latter.
_SCOPED_TOOL = "gateway_kb-search___kb_search"
_UNSCOPED_TOOL = "gateway_web-search___web_search"


class _FakeSigningKey:
    """Mimics the `.key` surface of a `jwt.PyJWKClient` signing key."""

    def __init__(self, key) -> None:
        self.key = key


class _FakePyJWKClient:
    """Stand-in for `jwt.PyJWKClient` backed by a local public key.

    Always returns the single fixture public key, so `jwt.decode` performs a
    genuine RS256 signature check against it — the verification path under test
    runs for real, only the network key fetch is replaced.
    """

    def __init__(self, public_key) -> None:
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token: str) -> _FakeSigningKey:  # noqa: ARG002
        return _FakeSigningKey(self._public_key)


@pytest.fixture(autouse=True)
def _local_jwks(monkeypatch):
    """Point `verify_user_pool_jwt` at the local fixture key set.

    Replaces the per-issuer JWKS client with one backed by SIGNING_PUBLIC_KEY,
    clears the cache, drops any audience env, and sets a default STACK_NAME so
    seam functions that read it have a value.
    """
    monkeypatch.setattr(
        auth,
        "_get_jwks_client",
        lambda issuer, jwks_url=None: _FakePyJWKClient(SIGNING_PUBLIC_KEY),
    )
    monkeypatch.delenv("COGNITO_USER_POOL_CLIENT_ID", raising=False)
    monkeypatch.setenv("STACK_NAME", "teststack")
    auth._jwks_clients.clear()


# --- Test-only Strands tool + model (mocks) -------------------------------


@tool
def _research_tool(query: str) -> str:
    """Stand-in research tool so the fraud agent builds without a live Gateway."""
    return query


class _FakeModel:
    """Minimal stand-in for a Strands model (only `stateful` is read at build)."""

    stateful = False


class _FakeToolEvent:
    """Minimal stand-in for Strands' BeforeToolCallEvent.

    The hook reads/mutates `tool_use["input"]` in place — that's all the
    injection assertions need.
    """

    def __init__(self, name: str, tool_input: dict[str, Any]) -> None:
        self.tool_use: dict[str, Any] = {"name": name, "input": tool_input}


# --- Helpers --------------------------------------------------------------


def _sign(payload: dict, *, key=SIGNING_KEY) -> str:
    return pyjwt.encode(payload, key, algorithm="RS256", headers={"kid": "test-key"})


def _valid_token(sub: str, *, ttl: int = 300) -> str:
    now = int(time.time())
    return _sign({"sub": sub, "iss": TEST_ISSUER, "iat": now, "exp": now + ttl})


def _verifier(token: str) -> dict[str, Any]:
    """The executor's injected verifier, bound to the test issuer."""
    return auth.verify_user_pool_jwt(token, issuer=TEST_ISSUER)


class _Ctx:
    """Minimal A2A RequestContext stand-in the executor reads via `_get`."""

    def __init__(self, message: Any, context_id: str) -> None:
        self.message = message
        self.context_id = context_id


class _FactorySpies:
    """Records whether the token/client/model factories were ever invoked.

    "The assessment ran" == the per-context agent was built, which is the only
    place these factories are called. If a gating check rejects first, all three
    stay at zero.
    """

    def __init__(self) -> None:
        self.token_calls = 0
        self.client_calls = 0
        self.model_calls = 0

    def token_provider(self) -> str:
        self.token_calls += 1
        return "fraud-token"

    def client_factory(self, access_token: str):  # noqa: ARG002
        self.client_calls += 1
        return _research_tool

    def model_factory(self, guardrail_config):  # noqa: ARG002
        self.model_calls += 1
        return _FakeModel()

    @property
    def any_called(self) -> bool:
        return bool(self.token_calls or self.client_calls or self.model_calls)


def _make_executor(spies: _FactorySpies, *, guardrail_loader=lambda: _GUARDRAIL_OK) -> FraudResearchExecutor:
    """Build a FraudResearchExecutor with every AWS-touching seam mocked."""
    return FraudResearchExecutor(
        verifier=_verifier,
        guardrail_loader=guardrail_loader,
        gateway_token_provider=spies.token_provider,
        gateway_client_factory=spies.client_factory,
        model_factory=spies.model_factory,
    )


def _run(coro):
    """Drive a coroutine to completion on a fresh event loop (per example)."""
    return asyncio.run(coro)


@contextlib.contextmanager
def _patched(obj: Any, name: str, value: Any):
    """Temporarily replace ``obj.name`` with ``value``, restoring afterwards."""
    original = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, original)


@contextlib.contextmanager
def _env(**kwargs: str | None):
    """Temporarily set/clear env vars, restoring prior values afterwards."""
    saved = {k: os.environ.get(k) for k in kwargs}
    for key, val in kwargs.items():
        if val is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = val
    try:
        yield
    finally:
        for key, val in saved.items():
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val


def _user_scope_hooks(agent) -> list[UserScopeHook]:
    """Return the `UserScopeHook` instances wired into an agent's hook registry.

    The registry stores each callback in a `_CallbackEntry(callback=..., order)`
    wrapper; unwrap it and keep the ones bound to a `UserScopeHook`.
    """
    entries = agent.hooks._registered_callbacks.get(BeforeToolCallEvent, [])
    hooks: list[UserScopeHook] = []
    for entry in entries:
        callback = getattr(entry, "callback", entry)
        owner = getattr(callback, "__self__", None)
        if isinstance(owner, UserScopeHook):
            hooks.append(owner)
    return hooks


def _inject_via_agent_hook(agent, *, forged_user_id: str = "attacker-supplied") -> str:
    """Drive the agent's UserScopeHook over a scoped tool call, return injected id."""
    hooks = _user_scope_hooks(agent)
    assert len(hooks) == 1, f"expected exactly one UserScopeHook, got {len(hooks)}"
    event = _FakeToolEvent(_SCOPED_TOOL, {"user_id": forged_user_id})
    hooks[0]._inject_user_id(event)
    return event.tool_use["input"]["user_id"]


# --- Shared strategies ----------------------------------------------------

_SUBS = st.text(min_size=1, max_size=64).filter(lambda s: s.strip() != "")
_FORGED = st.text(max_size=40)


@st.composite
def _applicants(draw: st.DrawFn) -> dict:
    """A synthetic account-opening applicant."""
    return {
        "full_name": draw(st.text(min_size=1, max_size=30).filter(lambda s: s.strip() != "")),
        "date_of_birth": draw(st.text(min_size=1, max_size=12).filter(lambda s: s.strip() != "")),
        "country": draw(st.sampled_from(["US", "GB", "DE", "JP", "BR"])),
        "declared_income": draw(st.integers(min_value=0, max_value=1_000_000)),
    }


# Arbitrary raw model outputs the artifact builder must normalize to schema.
_MODEL_OUTPUTS = st.one_of(
    st.none(),
    st.text(max_size=80),
    st.dictionaries(
        st.text(min_size=1, max_size=12),
        st.one_of(st.text(max_size=20), st.integers(-1000, 5000), st.booleans(), st.none()),
        max_size=6,
    ),
    st.builds(
        lambda a, r, s: json.dumps({"assessment": a, "risk_score": r, "signals": s, "rationale": "x"}),
        st.sampled_from(["clear", "review", "flagged", "bogus", "", "CLEAR"]),
        st.one_of(st.integers(-1000, 1000), st.text(max_size=5), st.none(), st.booleans()),
        st.lists(st.text(max_size=10), max_size=4),
    ),
)

# Stack-name segments used to derive OAuth client SSM parameter names.
_STACKS = st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-", min_size=1, max_size=24).filter(
    lambda s: s.strip() != ""
)


# --- Property 6 -----------------------------------------------------------


class TestProperty6CalleeBindsOneIdentityTwoOwners:
    """Feature: a2a-agent-collaboration, Property 6: The callee propagates one
    identity and both owners across the hop."""

    @settings(max_examples=120, deadline=None)
    @given(sub=_SUBS, forged=_FORGED)
    def test_valid_assertion_binds_verified_sub_and_owners(self, sub: str, forged: str) -> None:
        """Feature: a2a-agent-collaboration, Property 6: The callee propagates
        one identity and both owners across the hop.

        A valid customer assertion drives the executor to build a per-context
        agent whose `UserScopeHook` injects the verified `sub` (overriding any
        forged model-supplied `user_id`), whose span attributes carry that `sub`
        under owner `fraud_research`, while the caller-side identity context
        names the same `sub` under owner `ai_agent`.
        """
        token = _valid_token(sub)
        spies = _FactorySpies()
        executor = _make_executor(spies)

        captured: dict[str, Any] = {}

        async def fake_base(self, context, event_queue):  # noqa: ANN001, ARG001
            captured["agent"] = self._build_agent_for_context(context.context_id)

        ctx = _Ctx(message={"metadata": {"identity_context": token}}, context_id="ctx-6")
        with _patched(StrandsA2AExecutor, "execute", fake_base):
            _run(executor.execute(ctx, object()))

        agent = captured["agent"]

        # Callee span attributes: one identity (sub) under owner fraud_research.
        assert agent.trace_attributes["user.id"] == sub
        assert agent.trace_attributes["acting_agent"] == ACTING_AGENT_ID == "fraud_research"

        # The wired hook injects the verified sub, never the forged model value.
        assert _inject_via_agent_hook(agent, forged_user_id=forged) == sub

        # Caller step: the same verified sub, attributed to owner ai_agent.
        caller_metadata = build_identity_context(token)
        assert caller_metadata[ACTING_AGENT_KEY] == DEFAULT_ACTING_AGENT == "ai_agent"
        assert read_identity_context({"metadata": caller_metadata}) == token
        assert read_acting_agent({"metadata": caller_metadata}) == "ai_agent"

        # The assessment actually ran (agent built) for a valid request.
        assert spies.any_called

    @settings(max_examples=120, deadline=None)
    @given(sub=_SUBS)
    def test_verify_request_identity_returns_verified_sub(self, sub: str) -> None:
        """Feature: a2a-agent-collaboration, Property 6: The callee propagates
        one identity and both owners across the hop.

        The identity the executor binds is exactly the verified JWT `sub`.
        """
        message = {"metadata": {"identity_context": _valid_token(sub)}}
        claims = verify_request_identity(message, verifier=_verifier)
        assert claims["sub"] == sub


# --- Property 7 -----------------------------------------------------------


class TestProperty7CalleeRejectsUnverifiedIdentity:
    """Feature: a2a-agent-collaboration, Property 7: The callee rejects requests
    lacking a verified identity."""

    def _assert_rejected_without_assessment(self, message: Any) -> None:
        spies = _FactorySpies()
        executor = _make_executor(spies)
        ctx = _Ctx(message=message, context_id="ctx-7")
        with pytest.raises(ServerError):
            _run(executor.execute(ctx, object()))
        # The assessment never ran: no token/client/model factory was invoked.
        assert not spies.any_called

    @settings(max_examples=120, deadline=None)
    @given(metadata=st.sampled_from([None, {}, {"identity_context": ""}, {"identity_context": "   "}]))
    def test_missing_assertion_rejected(self, metadata) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (absent/blank assertion)."""
        message = {} if metadata is None else {"metadata": metadata}
        self._assert_rejected_without_assessment(message)

    @settings(max_examples=120, deadline=None)
    @given(garbage=st.text(max_size=80).filter(lambda s: s.strip() != ""))
    def test_malformed_assertion_rejected(self, garbage: str) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (malformed token)."""
        self._assert_rejected_without_assessment({"metadata": {"identity_context": garbage}})

    @settings(max_examples=120, deadline=None)
    @given(sub=_SUBS, age=st.integers(min_value=1, max_value=100_000))
    def test_expired_assertion_rejected(self, sub: str, age: int) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (expired token)."""
        now = int(time.time())
        token = _sign({"sub": sub, "iss": TEST_ISSUER, "iat": now - age - 10, "exp": now - age})
        self._assert_rejected_without_assessment({"metadata": {"identity_context": token}})

    @settings(max_examples=120, deadline=None)
    @given(sub=_SUBS)
    def test_bad_signature_assertion_rejected(self, sub: str) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (bad signature)."""
        token = _valid_token(sub)
        forged = _sign(
            {"sub": sub, "iss": TEST_ISSUER, "iat": int(time.time()), "exp": int(time.time()) + 300},
            key=WRONG_KEY,
        )
        assert token != forged  # sanity: distinct signatures
        self._assert_rejected_without_assessment({"metadata": {"identity_context": forged}})


# --- Property 8 -----------------------------------------------------------


class TestProperty8CalleeRejectsUnauthorizedCapabilities:
    """Feature: a2a-agent-collaboration, Property 8: The callee rejects
    unauthorized capabilities."""

    @settings(max_examples=120, deadline=None)
    @given(sub=_SUBS, requested=st.text(min_size=1, max_size=40).filter(lambda s: s.strip() != ""))
    def test_unadvertised_skill_rejected_without_assessment(self, sub: str, requested: str) -> None:
        """Feature: a2a-agent-collaboration, Property 8: The callee rejects
        unauthorized capabilities.

        Any requested skill/method other than the single advertised
        `fraud_research_assessment` is rejected before the assessment runs.
        """
        assume(requested != FRAUD_RESEARCH_SKILL_ID)
        spies = _FactorySpies()
        executor = _make_executor(spies)
        message = {"metadata": {"identity_context": _valid_token(sub), "skill": requested}}
        ctx = _Ctx(message=message, context_id="ctx-8")
        with pytest.raises(ServerError):
            _run(executor.execute(ctx, object()))
        assert not spies.any_called

    @settings(max_examples=150, deadline=None)
    @given(requested=st.text(max_size=40))
    def test_validate_requested_skill_seam(self, requested: str) -> None:
        """Feature: a2a-agent-collaboration, Property 8: The callee rejects
        unauthorized capabilities.

        The pure `validate_requested_skill` seam accepts only the advertised
        skill (or an unspecified skill) and rejects everything else with a
        capability rejection.
        """
        if requested.strip() == "" or requested == FRAUD_RESEARCH_SKILL_ID:
            # Blank/None defaults to the single advertised capability.
            validate_requested_skill(requested if requested.strip() else None)
            validate_requested_skill(FRAUD_RESEARCH_SKILL_ID)
        else:
            with pytest.raises(FraudRequestRejected) as exc_info:
                validate_requested_skill(requested)
            assert exc_info.value.reason == "capability"


# --- Property 9 -----------------------------------------------------------


class TestProperty9DistinctGatewayPrincipal:
    """Feature: a2a-agent-collaboration, Property 9: The fraud agent calls the
    Gateway as a distinct principal."""

    @settings(max_examples=150, deadline=None)
    @given(stack=_STACKS)
    def test_default_uses_fraud_client_distinct_from_machine(self, stack: str) -> None:
        """Feature: a2a-agent-collaboration, Property 9: The fraud agent calls
        the Gateway as a distinct principal.

        The default token minting uses the fraud agent's own client parameter,
        which is distinct from the shared machine client parameter.
        """
        captured: dict[str, str] = {}

        def spy(client_id_param: str, secret_param: str, **_kwargs):
            captured["client_id_param"] = client_id_param
            captured["secret_param"] = secret_param
            return "fraud-token"

        with (
            _patched(fra, "get_agent_access_token", spy),
            _env(STACK_NAME=stack, FRAUD_AGENT_CLIENT_ID_PARAM=None, FRAUD_AGENT_CLIENT_SECRET_PARAM=None),
        ):
            token = fraud_gateway_access_token()

        assert token == "fraud-token"
        assert captured["client_id_param"] == f"/{stack}/fraud_agent_client_id"
        assert captured["secret_param"] == f"/{stack}/fraud_agent_client_secret"
        # Distinct from the shared machine client the account-opening agent uses.
        assert captured["client_id_param"] != f"/{stack}/machine_client_id"
        assert "fraud" in captured["client_id_param"]

    @settings(max_examples=120, deadline=None)
    @given(stack=_STACKS, seg=st.text(alphabet="abcdefghijklmnopqrstuvwxyz_", min_size=1, max_size=16))
    def test_explicit_override_honored_and_distinct(self, stack: str, seg: str) -> None:
        """Feature: a2a-agent-collaboration, Property 9: The fraud agent calls
        the Gateway as a distinct principal.

        An explicit fraud-client parameter override is honored and remains
        distinct from the shared machine client parameter.
        """
        client_param = f"/{stack}/{seg}_fraud_client_id"
        secret_param = f"/{stack}/{seg}_fraud_client_secret"
        assume(client_param != f"/{stack}/machine_client_id")
        captured: dict[str, str] = {}

        def spy(cid_param: str, sec_param: str, **_kwargs):
            captured["client_id_param"] = cid_param
            captured["secret_param"] = sec_param
            return "fraud-token"

        with (
            _patched(fra, "get_agent_access_token", spy),
            _env(
                STACK_NAME=stack,
                FRAUD_AGENT_CLIENT_ID_PARAM=client_param,
                FRAUD_AGENT_CLIENT_SECRET_PARAM=secret_param,
            ),
        ):
            fraud_gateway_access_token()

        assert captured["client_id_param"] == client_param
        assert captured["secret_param"] == secret_param
        assert captured["client_id_param"] != f"/{stack}/machine_client_id"


# --- Property 10 ----------------------------------------------------------


class TestProperty10GuardrailBlocksModelCall:
    """Feature: a2a-agent-collaboration, Property 10: A model call is blocked
    when its guardrail cannot be applied."""

    @settings(max_examples=120, deadline=None)
    @given(sub=_SUBS, unavailable=st.sampled_from([None, {}]))
    def test_execute_blocks_model_when_guardrail_unavailable(self, sub: str, unavailable) -> None:
        """Feature: a2a-agent-collaboration, Property 10: A model call is
        blocked when its guardrail cannot be applied.

        When the guardrail config is unavailable the executor raises before the
        agent (and thus the model) is built — the model call is never issued.
        """
        spies = _FactorySpies()
        executor = _make_executor(spies, guardrail_loader=lambda: unavailable)
        message = {"metadata": {"identity_context": _valid_token(sub)}}
        ctx = _Ctx(message=message, context_id="ctx-10")
        with pytest.raises(ServerError):
            _run(executor.execute(ctx, object()))
        # The model factory (the model call) was never invoked.
        assert spies.model_calls == 0
        assert not spies.any_called

    @settings(max_examples=150, deadline=None)
    @given(unavailable=st.sampled_from([None, {}]))
    def test_ensure_guardrail_config_rejects_unavailable(self, unavailable) -> None:
        """Feature: a2a-agent-collaboration, Property 10: A model call is
        blocked when its guardrail cannot be applied (seam).

        `ensure_guardrail_config` raises when no usable guardrail is available
        and returns the config unchanged when one is.
        """
        with pytest.raises(GuardrailUnavailableError):
            ensure_guardrail_config(loader=lambda: unavailable)
        assert ensure_guardrail_config(loader=lambda: _GUARDRAIL_OK) == _GUARDRAIL_OK


# --- Property 11 ----------------------------------------------------------


class TestProperty11AssessmentWellFormed:
    """Feature: a2a-agent-collaboration, Property 11: The assessment result is
    well-formed."""

    def _assert_schema_valid(self, artifact: dict, *, customer_sub: str) -> None:
        assert artifact["assessment"] in VALID_ASSESSMENTS
        assert isinstance(artifact["risk_score"], int) and not isinstance(artifact["risk_score"], bool)
        assert 0 <= artifact["risk_score"] <= 100
        assert isinstance(artifact["signals"], list)
        assert all(isinstance(signal, str) for signal in artifact["signals"])
        assert isinstance(artifact["rationale"], str)
        assert artifact["acting_customer_sub"] == customer_sub
        assert artifact["acting_agent"] == ACTING_AGENT_ID == "fraud_research"

    @settings(max_examples=200, deadline=None)
    @given(model_output=_MODEL_OUTPUTS, customer_sub=_SUBS)
    def test_artifact_is_schema_valid_for_any_model_output(self, model_output, customer_sub: str) -> None:
        """Feature: a2a-agent-collaboration, Property 11: The assessment result
        is well-formed.

        Whatever the (mocked) model returns, the artifact conforms to the
        assessment schema and stamps the verified customer sub + acting-agent id.
        """
        artifact = build_assessment_artifact(model_output, customer_sub=customer_sub)
        self._assert_schema_valid(artifact, customer_sub=customer_sub)

    @settings(max_examples=200, deadline=None)
    @given(
        applicant=_applicants(),
        verdict=st.sampled_from(VALID_ASSESSMENTS),
        score=st.integers(min_value=0, max_value=100),
        customer_sub=_SUBS,
    )
    def test_valid_model_output_over_applicant_is_preserved(
        self, applicant: dict, verdict: str, score: int, customer_sub: str
    ) -> None:
        """Feature: a2a-agent-collaboration, Property 11: The assessment result
        is well-formed.

        For a valid synthetic applicant and a well-formed model verdict, the
        artifact preserves the verdict/score and remains schema-valid.
        """
        model_output = json.dumps(
            {
                "assessment": verdict,
                "risk_score": score,
                "signals": [f"reviewed {key}" for key in applicant],
                "rationale": "grounded in synthetic research",
            }
        )
        artifact = build_assessment_artifact(model_output, customer_sub=customer_sub)
        self._assert_schema_valid(artifact, customer_sub=customer_sub)
        assert artifact["assessment"] == verdict
        assert artifact["risk_score"] == score


# --- Property 12 ----------------------------------------------------------


class TestProperty12ConcurrentUsersNeverCrossIdentities:
    """Feature: a2a-agent-collaboration, Property 12: Concurrent users never
    cross identities."""

    @settings(max_examples=100, deadline=None)
    @given(sub_a=_SUBS, sub_b=_SUBS)
    def test_two_concurrent_requests_keep_distinct_user_ids(self, sub_a: str, sub_b: str) -> None:
        """Feature: a2a-agent-collaboration, Property 12: Concurrent users never
        cross identities.

        Two requests processed concurrently under distinct verified `sub`
        values each build an agent whose injected Gateway `user_id` equals its
        own assertion's `sub` — neither identity bleeds into the other.
        """
        assume(sub_a != sub_b)
        spies = _FactorySpies()
        executor = _make_executor(spies)

        captured: dict[str, Any] = {}
        barrier = asyncio.Barrier(2)

        async def fake_base(self, context, event_queue):  # noqa: ANN001, ARG001
            # Both requests have set their per-context pending identity before
            # either builds its agent — proves the binding is not clobbered.
            await barrier.wait()
            captured[context.context_id] = self._build_agent_for_context(context.context_id)

        ctx_a = _Ctx(message={"metadata": {"identity_context": _valid_token(sub_a)}}, context_id="ctx-a")
        ctx_b = _Ctx(message={"metadata": {"identity_context": _valid_token(sub_b)}}, context_id="ctx-b")

        async def drive():
            await asyncio.gather(
                executor.execute(ctx_a, object()),
                executor.execute(ctx_b, object()),
            )

        with _patched(StrandsA2AExecutor, "execute", fake_base):
            _run(drive())

        agent_a = captured["ctx-a"]
        agent_b = captured["ctx-b"]

        # Each agent's span identity is its own sub.
        assert agent_a.trace_attributes["user.id"] == sub_a
        assert agent_b.trace_attributes["user.id"] == sub_b

        # Each agent's hook injects only its own sub — no cross-contamination.
        assert _inject_via_agent_hook(agent_a, forged_user_id=sub_b) == sub_a
        assert _inject_via_agent_hook(agent_b, forged_user_id=sub_a) == sub_b
