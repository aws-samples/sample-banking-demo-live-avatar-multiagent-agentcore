# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Self-hosted x402 merchant — a paywalled premium-data endpoint for the demo.

Why this exists
---------------
The Deep Research Agent needs a paid data source to demonstrate AgentCore
Payments, but the demo must stay self-contained: no external APIs, no real
funds, deploy and destroy with plain CDK. So the paywall lives in the stack.

This Lambda implements the merchant half of the x402 protocol:

  1. A request with no `X-PAYMENT` header gets **HTTP 402 Payment Required**
     plus an x402 challenge describing what to pay, to whom, and on which
     network.
  2. AgentCore Payments sees the 402, signs a stablecoin transfer with the
     configured wallet, and retries the request with proof in `X-PAYMENT`.
  3. This handler accepts the proof and returns the premium dataset, echoing
     a settlement receipt in `X-PAYMENT-RESPONSE`.

Scope of the verification
-------------------------
This is a DEMONSTRATION merchant. It validates that a structurally valid
x402 payment payload is present and well-formed; it does NOT verify on-chain
settlement, because doing so would require an external RPC call to a
blockchain node and break the demo's self-containment. That boundary is
deliberate and is stated in the response body (`verification: "structural"`)
so nobody reads a demo receipt as proof of funds.

All datasets served here are SYNTHETIC and generated for the demonstration.
They are shaped to match the research brief (Texas Stock Exchange plus NYSE /
Nasdaq / European venues, deposit-rate benchmarks, compensation bands).
"""

import base64
import binascii
import json
import logging
import os
import uuid
from datetime import datetime, timezone

# Stdlib logging only: this handler has no dependency beyond the Python runtime,
# so the asset needs no pip bundling step at deploy time.
logger = logging.getLogger(__name__)
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

# Price per query, in the smallest unit of the asset (USDC has 6 decimals),
# so 2500 == $0.0025. Microtransaction pricing is the whole point: this is a
# figure no card network would process economically.
PRICE_ATOMIC_UNITS = os.environ.get("PRICE_ATOMIC_UNITS", "2500")
PRICE_DISPLAY_USD = os.environ.get("PRICE_DISPLAY_USD", "0.0025")
# Base Sepolia testnet by default — testnet funds come from a faucet, so the
# demo moves no real money. Overridable for an operator who wants mainnet.
PAY_NETWORK = os.environ.get("PAY_NETWORK", "eip155:84532")
PAY_TO_ADDRESS = os.environ.get("PAY_TO_ADDRESS", "")
ASSET_ADDRESS = os.environ.get("ASSET_ADDRESS", "")
ASSET_NAME = os.environ.get("ASSET_NAME", "USDC")

PAYMENT_HEADER = "x-payment"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _challenge(resource: str) -> dict:
    """Build the x402 `accepts` challenge advertised with the 402 response."""
    return {
        "x402Version": 2,
        "error": "payment_required",
        "accepts": [
            {
                "scheme": "exact",
                "network": PAY_NETWORK,
                "maxAmountRequired": PRICE_ATOMIC_UNITS,
                "asset": ASSET_ADDRESS,
                "payTo": PAY_TO_ADDRESS,
                "resource": resource,
                "description": (
                    "Trinity Reserve premium market intelligence — single query. "
                    "Synthetic demonstration dataset."
                ),
                "mimeType": "application/json",
                "maxTimeoutSeconds": 300,
                "extra": {"name": ASSET_NAME, "version": "2"},
            }
        ],
    }


# ---------------------------------------------------------------------------
# Synthetic premium datasets
#
# Shaped to the research brief so the researcher's purchase is materially
# useful to the report rather than decorative. Every figure is invented for
# the demonstration.
# ---------------------------------------------------------------------------

_DATASETS: dict[str, dict] = {
    "exchange-activity": {
        "dataset": "Multi-venue listing & trading activity",
        "as_of": "2026-Q2",
        "venues": [
            {"venue": "TXSE", "city": "Dallas", "listings": 148, "avg_daily_volume_musd": 2140.5},
            {"venue": "NYSE", "city": "New York", "listings": 2183, "avg_daily_volume_musd": 84200.0},
            {"venue": "Nasdaq", "city": "New York", "listings": 3421, "avg_daily_volume_musd": 91750.0},
            {"venue": "Euronext", "city": "Amsterdam", "listings": 1870, "avg_daily_volume_musd": 12480.0},
            {"venue": "LSE", "city": "London", "listings": 1102, "avg_daily_volume_musd": 9310.0},
            {"venue": "Deutsche Boerse", "city": "Frankfurt", "listings": 726, "avg_daily_volume_musd": 8420.0},
        ],
        "notes": "TXSE listing growth of 31% QoQ is the fastest among tracked venues.",
    },
    "deposit-benchmarks": {
        "dataset": "Regional deposit pricing benchmarks",
        "as_of": "2026-Q2",
        "region": "Dallas-Fort Worth, TX",
        "benchmarks": [
            {"product": "High-Yield Savings", "market_median_apy": 3.95, "top_decile_apy": 4.35},
            {"product": "12-month CD", "market_median_apy": 4.10, "top_decile_apy": 4.55},
            {"product": "Interest Checking", "market_median_apy": 0.85, "top_decile_apy": 1.60},
        ],
        "notes": "A 4.15% APY on savings sits in the 78th percentile for the metro.",
    },
    "compensation-bands": {
        "dataset": "Banking compensation bands",
        "as_of": "2026-Q2",
        "region": "Dallas-Fort Worth, TX",
        "roles": [
            {"role": "Branch Manager", "p25_usd": 96000, "median_usd": 118000, "p75_usd": 141000},
            {"role": "Relationship Manager", "p25_usd": 84000, "median_usd": 103000, "p75_usd": 126000},
            {"role": "AML/Fraud Analyst", "p25_usd": 78000, "median_usd": 97000, "p75_usd": 119000},
            {"role": "Wealth Advisor", "p25_usd": 110000, "median_usd": 142000, "p75_usd": 188000},
        ],
        "notes": "Internal-use benchmark. Not for disclosure to customers.",
    },
    "fraud-signals": {
        "dataset": "Account-fraud typology prevalence",
        "as_of": "2026-Q2",
        "typologies": [
            {"typology": "Synthetic identity", "share_of_cases_pct": 31.4, "yoy_change_pct": 8.2},
            {"typology": "Account takeover", "share_of_cases_pct": 27.9, "yoy_change_pct": -3.1},
            {"typology": "Mule account layering", "share_of_cases_pct": 22.6, "yoy_change_pct": 11.7},
            {"typology": "First-party deposit fraud", "share_of_cases_pct": 18.1, "yoy_change_pct": 2.4},
        ],
        "notes": "Synthetic identity now leads new-account fraud in the metro.",
    },
}

_CATALOG = [
    {"id": key, "title": value["dataset"], "price_usd": PRICE_DISPLAY_USD} for key, value in _DATASETS.items()
]


def _decode_payment(raw: str) -> dict | None:
    """Decode an x402 `X-PAYMENT` header.

    The header is base64-encoded JSON per the x402 spec, but tolerate raw JSON
    too so the endpoint is easy to exercise by hand during development.
    """
    if not raw:
        return None
    try:
        decoded = base64.b64decode(raw, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        decoded = raw
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _payment_is_structurally_valid(payment: dict) -> tuple[bool, str]:
    """Check the proof carries the fields a settlement layer would need.

    Returns (ok, reason). Deliberately structural — see the module docstring.
    """
    payload = payment.get("payload")
    if not isinstance(payload, dict):
        return False, "missing payload object"
    # A signed x402 transfer carries the signature and the authorization it
    # covers. Absent either, there is nothing a merchant could ever settle.
    if not payload.get("signature"):
        return False, "missing signature"
    authorization = payload.get("authorization")
    if not isinstance(authorization, dict):
        return False, "missing authorization object"
    for field in ("from", "to", "value"):
        if not authorization.get(field):
            return False, f"authorization missing {field}"
    return True, "ok"


def _response(status: int, body: dict, extra_headers: dict | None = None) -> dict:
    headers = {
        "Content-Type": "application/json",
        # Advertise the payment scheme on every response so a client can
        # discover how to pay without a failed request first.
        "X-Accept-Payment": "x402",
    }
    if extra_headers:
        headers.update(extra_headers)
    return {"statusCode": status, "headers": headers, "body": json.dumps(body)}


def handler(event, context):  # noqa: ANN001, ARG001
    """Serve the catalog freely; put the datasets behind an x402 paywall."""
    path = (event.get("rawPath") or event.get("path") or "/").rstrip("/")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}

    # Route on the presence of a `/data/` segment rather than on the last path
    # component. API Gateway prefixes the stage (`/prod/x402`), so keying off
    # the trailing segment made the catalog URL look like a dataset id and 404.
    dataset_id = ""
    if "/data/" in f"{path}/":
        dataset_id = path.split("/data/", 1)[1].split("/", 1)[0]

    # The catalog is free on purpose: the agent must be able to discover what
    # is for sale, and at what price, before deciding to spend the budget.
    if not dataset_id:
        return _response(
            200,
            {
                "merchant": "Trinity Reserve Premium Data (demonstration)",
                "payment_protocol": "x402",
                "price_per_query_usd": PRICE_DISPLAY_USD,
                "network": PAY_NETWORK,
                "datasets": _CATALOG,
                "note": "All datasets are synthetic and generated for this demonstration.",
            },
        )

    dataset = _DATASETS.get(dataset_id)
    if dataset is None:
        return _response(404, {"error": "unknown_dataset", "available": [d["id"] for d in _CATALOG]})

    resource = f"{path}"
    raw_payment = headers.get(PAYMENT_HEADER, "")

    if not raw_payment:
        # The paywall. AgentCore Payments intercepts this, pays, and retries.
        logger.info("402 Payment Required issued for dataset %s", dataset_id)
        return _response(402, _challenge(resource))

    payment = _decode_payment(raw_payment)
    if payment is None:
        return _response(400, {"error": "invalid_payment_header", "detail": "not base64 JSON"})

    ok, reason = _payment_is_structurally_valid(payment)
    if not ok:
        logger.warning("Payment rejected for dataset %s: %s", dataset_id, reason)
        return _response(402, {**_challenge(resource), "error": f"payment_invalid: {reason}"})

    receipt = {
        "settlementId": str(uuid.uuid4()),
        "amount": PRICE_ATOMIC_UNITS,
        "asset": ASSET_NAME,
        "network": PAY_NETWORK,
        "settledAt": _now(),
        # Named plainly so a demo receipt is never mistaken for proof of funds.
        "verification": "structural",
    }
    logger.info("Payment accepted for dataset %s (settlement %s)", dataset_id, receipt["settlementId"])

    return _response(
        200,
        {
            "dataset_id": dataset_id,
            "paid": True,
            "price_usd": PRICE_DISPLAY_USD,
            "receipt": receipt,
            "data": dataset,
            "disclosure": "Synthetic dataset generated for demonstration purposes.",
        },
        extra_headers={"X-PAYMENT-RESPONSE": base64.b64encode(json.dumps(receipt).encode()).decode()},
    )
