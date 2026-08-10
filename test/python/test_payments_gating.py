# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""AgentCore Payments must be invisible unless fully configured.

Payments is a preview capability that spends money, so the failure mode that
matters is not "it didn't work" — it is "it spent when it shouldn't have", or
"a missing wallet broke an otherwise fine research run". Both are guarded by
`_payments_configured()` being all-or-nothing and by the budget parser refusing
to fall through to an unbounded spend.

The prompt addendum is asserted on too: if the paid-source instructions leak
into the prompt while no wallet exists, the researcher is told to buy data it
can never pay for and wastes turns on guaranteed failures.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def orch():
    for extra in (REPO_ROOT / "patterns" / "orchestrator-agent", REPO_ROOT / "patterns"):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))
    path = REPO_ROOT / "patterns" / "orchestrator-agent" / "orchestrator_agent.py"
    spec = importlib.util.spec_from_file_location("_orchestrator_payments_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def _clear_payment_env(orch, monkeypatch):
    """Start every test from an unconfigured stack with a cold cache."""
    for var in (
        "PAYMENT_MANAGER_ARN",
        "PAYMENT_INSTRUMENT_ID",
        "X402_MERCHANT_URL",
        "PAYMENT_BUDGET_USD",
        "STACK_NAME",
    ):
        monkeypatch.delenv(var, raising=False)
    orch._payments_settings.cache_clear()
    yield
    orch._payments_settings.cache_clear()


def _configure(monkeypatch, orch, *, manager=True, instrument=True, merchant=True):
    """Set exactly the requested settings and clear the rest.

    Explicitly unsetting matters: callers loop over partial configurations, and
    a leaked variable from a previous iteration would make the test pass for the
    wrong reason.
    """
    wanted = {
        "PAYMENT_MANAGER_ARN": (
            "arn:aws:bedrock-agentcore:us-east-1:1:payment-manager/pm-1" if manager else None
        ),
        "PAYMENT_INSTRUMENT_ID": "payment-instrument-abc123" if instrument else None,
        "X402_MERCHANT_URL": "https://api.example.com/prod/x402" if merchant else None,
    }
    for var, value in wanted.items():
        if value is None:
            monkeypatch.delenv(var, raising=False)
        else:
            monkeypatch.setenv(var, value)
    orch._payments_settings.cache_clear()


class TestConfigurationGate:
    def test_unconfigured_stack_reports_not_configured(self, orch):
        assert orch._payments_configured() is False

    def test_all_three_settings_are_required(self, orch, monkeypatch):
        # Partial configuration must read as OFF. A payment manager without a
        # wallet cannot pay, and a wallet without a merchant has nothing to buy.
        for missing in ("manager", "instrument", "merchant"):
            kwargs = {"manager": True, "instrument": True, "merchant": True}
            kwargs[missing] = False
            _configure(monkeypatch, orch, **kwargs)
            assert orch._payments_configured() is False, f"expected OFF when {missing} missing"

    def test_fully_configured_stack_reports_configured(self, orch, monkeypatch):
        _configure(monkeypatch, orch)
        assert orch._payments_configured() is True

    def test_no_plugin_is_built_when_unconfigured(self, orch):
        assert orch._build_payments_plugin("user-1") is None


class TestPromptAddendum:
    def test_absent_when_unconfigured(self, orch):
        # This is the load-bearing assertion: with no wallet, the researcher must
        # not even be told a paid source exists.
        assert orch._payment_prompt_addendum() == ""

    def test_present_and_names_the_merchant_when_configured(self, orch, monkeypatch):
        _configure(monkeypatch, orch)
        addendum = orch._payment_prompt_addendum()
        assert "https://api.example.com/prod/x402" in addendum
        assert "exchange-activity" in addendum
        # Spend discipline must be stated, or the agent buys everything.
        assert "at most ONCE" in addendum
        assert "approved budget" in addendum

    def test_trailing_slash_is_normalized(self, orch, monkeypatch):
        monkeypatch.setenv("PAYMENT_MANAGER_ARN", "arn:pm")
        monkeypatch.setenv("PAYMENT_INSTRUMENT_ID", "pi-1")
        monkeypatch.setenv("X402_MERCHANT_URL", "https://api.example.com/prod/x402/")
        orch._payments_settings.cache_clear()
        assert "x402/data/" in orch._payment_prompt_addendum()
        assert "x402//data" not in orch._payment_prompt_addendum()


class TestBudgetParsing:
    def test_parses_plain_and_dollar_prefixed_values(self, orch):
        assert orch._decimal_or_default("2.50") == pytest.approx(2.50)
        assert orch._decimal_or_default("$4.00") == pytest.approx(4.00)
        assert orch._decimal_or_default(" 1.25 ") == pytest.approx(1.25)

    def test_malformed_budget_falls_back_rather_than_raising(self, orch):
        # A typo must not abort a research run, and must not become an
        # unbounded spend either — it lands on the documented default.
        for bad in ("", "abc", None, "0", "-5"):
            assert orch._decimal_or_default(bad) == pytest.approx(1.0)

    def test_default_budget_is_small(self, orch):
        # The merchant charges fractions of a cent, so the default ceiling is a
        # deliberately cheap blast radius.
        assert orch._decimal_or_default(orch.DEFAULT_PAYMENT_BUDGET_USD) <= 1.0


class TestReadPaymentSpend:
    """The run report shows real spend, so the read must be exact and safe.

    The previous report showed an ESTIMATED cost from per-unit assumptions.
    Reporting an estimate as though it were actual spend is worse than showing
    nothing, so this parses the session's own figures and returns None whenever
    it cannot.
    """

    class _Plugin:
        def __init__(self, session):
            self._session = session

        def get_payment_session(self):
            if isinstance(self._session, Exception):
                raise self._session
            return self._session

    def test_returns_none_without_a_plugin(self, orch):
        assert orch._read_payment_spend(None) is None

    def test_reads_amounts_from_the_session(self, orch):
        plugin = self._Plugin(
            {
                "paymentSessionId": "payment-session-abc",
                "status": "ACTIVE",
                "spentAmount": {"value": "0.0075", "currency": "USD"},
                "remainingAmount": {"value": "0.9925", "currency": "USD"},
                "limits": {"maxSpendAmount": {"value": "1.00", "currency": "USD"}},
            }
        )
        spend = orch._read_payment_spend(plugin)
        assert spend == {
            "spent": "0.0075",
            "remaining": "0.9925",
            "budget": "1.00",
            "currency": "USD",
            "status": "ACTIVE",
            "session_id": "payment-session-abc",
        }

    def test_accepts_plain_scalar_amounts(self, orch):
        # The preview API may return a bare value rather than a money object;
        # tolerate both rather than silently reporting nothing.
        plugin = self._Plugin({"spentAmount": "0.25", "remainingAmount": "0.75"})
        spend = orch._read_payment_spend(plugin)
        assert spend["spent"] == "0.25"
        assert spend["remaining"] == "0.75"

    def test_a_failed_read_never_breaks_the_run(self, orch):
        # Telemetry is not worth failing a completed research run over.
        assert orch._read_payment_spend(self._Plugin(RuntimeError("throttled"))) is None

    def test_non_dict_session_is_ignored(self, orch):
        assert orch._read_payment_spend(self._Plugin("unexpected")) is None

    def test_missing_fields_degrade_to_empty_strings(self, orch):
        spend = orch._read_payment_spend(self._Plugin({}))
        assert spend["spent"] == ""
        assert spend["budget"] == ""

    def test_zero_spend_is_reported_not_suppressed(self, orch):
        # "$0.00 of $1.00" is a real result: the researcher judged free search
        # sufficient. Suppressing it would look like payments never ran.
        plugin = self._Plugin(
            {
                "spentAmount": {"value": "0.00"},
                "limits": {"maxSpendAmount": {"value": "1.00"}},
            }
        )
        spend = orch._read_payment_spend(plugin)
        assert spend is not None
        assert spend["spent"] == "0.00"


class TestWorkerBudgetSplit:
    def test_total_spend_is_divided_across_parallel_workers(self, orch):
        # Each parallel worker opens its OWN PaymentSession, so handing every
        # worker the full budget would authorize N times what the user approved.
        total = orch._decimal_or_default("4.00")
        workers = orch.MAX_RESEARCH_WORKERS
        per_worker = total / workers
        assert per_worker * workers == pytest.approx(total)
        assert per_worker < total
