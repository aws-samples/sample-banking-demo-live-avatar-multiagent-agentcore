# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The self-hosted x402 merchant is what keeps the payments demo self-contained.

It stands in for a paywalled premium-data vendor so the Deep Research Agent can
exercise AgentCore Payments without calling an external API or moving real
funds. Two behaviours are load-bearing:

  1. The paywall actually holds — an unpaid request must never return data, or
     the demo proves nothing.
  2. The catalog stays free — the agent has to be able to see what is for sale,
     and at what price, before deciding to spend an approved budget.

The verification is deliberately structural (no blockchain call), so the
receipt says so. That honesty is asserted here to stop a future change from
quietly implying settlement was verified.
"""

import base64
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MERCHANT = REPO_ROOT / "lib" / "lambdas" / "x402-merchant" / "index.py"


class _Ctx:
    function_name = "x402-merchant"
    memory_limit_in_mb = 512
    invoked_function_arn = "arn:aws:lambda:us-east-1:1:function:x402-merchant"
    aws_request_id = "test-request"


@pytest.fixture(scope="module")
def merchant(monkeypatch_module=None):
    spec = importlib.util.spec_from_file_location("_x402_merchant_under_test", MERCHANT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _call(merchant, path, headers=None):
    return merchant.handler({"path": path, "headers": headers or {}}, _Ctx())


def _proof(signature="0xsig", authorization=None):
    payload = {"signature": signature}
    if authorization is not None:
        payload["authorization"] = authorization
    body = json.dumps({"payload": payload})
    return base64.b64encode(body.encode()).decode()


_VALID_AUTH = {"from": "0xpayer", "to": "0xmerchant", "value": "2500"}


class TestFreeCatalog:
    def test_catalog_is_reachable_without_payment(self, merchant):
        response = _call(merchant, "/x402")
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        # The agent must be able to price the decision before committing spend.
        assert body["price_per_query_usd"]
        assert len(body["datasets"]) >= 4

    def test_catalog_discloses_that_data_is_synthetic(self, merchant):
        body = json.loads(_call(merchant, "/x402")["body"])
        assert "synthetic" in body["note"].lower()


class TestPaywall:
    def test_unpaid_request_returns_402_and_no_data(self, merchant):
        response = _call(merchant, "/x402/data/deposit-benchmarks")
        assert response["statusCode"] == 402
        body = json.loads(response["body"])
        assert "data" not in body
        # The challenge has to tell the payer what, where, and how much.
        accepts = body["accepts"][0]
        for field in ("scheme", "network", "maxAmountRequired", "payTo", "asset"):
            assert field in accepts

    def test_unknown_dataset_is_404_not_a_paywall(self, merchant):
        # Charging for a dataset that does not exist would be indefensible.
        response = _call(merchant, "/x402/data/does-not-exist")
        assert response["statusCode"] == 404

    def test_undecodable_payment_header_is_rejected(self, merchant):
        response = _call(merchant, "/x402/data/deposit-benchmarks", {"X-PAYMENT": "###"})
        assert response["statusCode"] == 400

    @pytest.mark.parametrize(
        "proof,reason",
        [
            (_proof(signature=""), "signature"),
            (_proof(authorization=None), "authorization"),
            (_proof(authorization={"from": "0xa", "to": "0xb"}), "value"),
            (_proof(authorization={"to": "0xb", "value": "1"}), "from"),
        ],
    )
    def test_incomplete_proof_stays_behind_the_paywall(self, merchant, proof, reason):
        response = _call(merchant, "/x402/data/deposit-benchmarks", {"X-PAYMENT": proof})
        assert response["statusCode"] == 402
        assert reason in json.loads(response["body"])["error"]


class TestPaidAccess:
    def test_valid_proof_unlocks_the_dataset(self, merchant):
        response = _call(
            merchant,
            "/x402/data/deposit-benchmarks",
            {"X-PAYMENT": _proof(authorization=_VALID_AUTH)},
        )
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["paid"] is True
        assert body["data"]["benchmarks"]

    def test_receipt_is_returned_in_the_x402_response_header(self, merchant):
        response = _call(
            merchant, "/x402/data/fraud-signals", {"X-PAYMENT": _proof(authorization=_VALID_AUTH)}
        )
        raw = response["headers"]["X-PAYMENT-RESPONSE"]
        receipt = json.loads(base64.b64decode(raw))
        assert receipt["settlementId"]
        assert receipt["asset"] == "USDC"

    def test_receipt_states_verification_is_only_structural(self, merchant):
        # A demo receipt must never read as proof of on-chain settlement.
        body = json.loads(
            _call(
                merchant,
                "/x402/data/fraud-signals",
                {"X-PAYMENT": _proof(authorization=_VALID_AUTH)},
            )["body"]
        )
        assert body["receipt"]["verification"] == "structural"
        assert "synthetic" in body["disclosure"].lower()

    def test_every_advertised_dataset_is_purchasable(self, merchant):
        # A catalog entry that 404s after payment would be a charge for nothing.
        catalog = json.loads(_call(merchant, "/x402")["body"])["datasets"]
        for entry in catalog:
            response = _call(
                merchant,
                f"/x402/data/{entry['id']}",
                {"X-PAYMENT": _proof(authorization=_VALID_AUTH)},
            )
            assert response["statusCode"] == 200, entry["id"]
            assert json.loads(response["body"])["data"]


class TestBriefAlignment:
    def test_datasets_cover_the_research_brief(self, merchant):
        """The purchase must be materially useful to the report, not decorative."""
        ids = {d["id"] for d in json.loads(_call(merchant, "/x402")["body"])["datasets"]}
        # Multi-exchange strategy, deposit products, salary bands, fraud
        # detection — each is an explicit requirement of the founder's brief.
        assert {"exchange-activity", "deposit-benchmarks", "compensation-bands", "fraud-signals"} <= ids

    def test_exchange_dataset_names_the_venues_from_the_brief(self, merchant):
        body = json.loads(
            _call(
                merchant,
                "/x402/data/exchange-activity",
                {"X-PAYMENT": _proof(authorization=_VALID_AUTH)},
            )["body"]
        )
        venues = {v["venue"] for v in body["data"]["venues"]}
        assert {"TXSE", "NYSE", "Nasdaq"} <= venues
