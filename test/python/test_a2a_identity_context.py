"""Property-based tests for the A2A identity-context build/verify seam.

Covers two of the design's correctness properties for the fraud-hop identity
propagation:

* **Property 5 — Identity context is bound from the verified JWT, never from
  model input.** `build_identity_context` (`patterns/utils/identity_context.py`)
  takes only the already-verified customer JWT — there is no `user_id`
  argument — so a model-supplied value has no seam through which to override
  the verified `sub`. The property asserts the produced
  `metadata.identity_context` always decodes to the verified `sub`, whatever
  (forged/mismatched) `user_id` the model might have produced.

* **Property 7 — The callee rejects requests lacking a verified identity.**
  `verify_user_pool_jwt` (`patterns/utils/auth.py`) is the callee-side
  verifier. Signing test JWTs with a locally generated RSA key exposed through
  a stand-in JWKS client, the property asserts valid tokens are accepted and
  missing/malformed/expired/wrong-signature tokens are rejected with
  `IdentityVerificationError`.

Both properties run >= 100 Hypothesis examples. RSA key material is generated
once at import (key generation is expensive) and reused across examples; only
signing happens per example.
"""

from __future__ import annotations

import base64
import json
import time

import auth
import jwt as pyjwt
import pytest
from auth import IdentityVerificationError, verify_user_pool_jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from hypothesis import given, settings
from hypothesis import strategies as st
from identity_context import (
    ACTING_AGENT_KEY,
    IDENTITY_CONTEXT_KEY,
    build_identity_context,
    read_identity_context,
)

# --- Local RSA key material + JWKS stand-in -------------------------------

# Generated once — RSA key generation is far too slow to run per Hypothesis
# example. SIGNING_KEY backs the fixture JWKS; WRONG_KEY is an unrelated key
# used to forge bad-signature tokens the verifier must reject.
SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
SIGNING_PUBLIC_KEY = SIGNING_KEY.public_key()
WRONG_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)

TEST_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool"


class _FakeSigningKey:
    """Mimics the `.key` surface of a `jwt.PyJWKClient` signing key."""

    def __init__(self, key) -> None:
        self.key = key


class _FakePyJWKClient:
    """Stand-in for `jwt.PyJWKClient` backed by a local public key.

    The real client fetches a JWKS over HTTP and resolves the signing key by
    the token's `kid`. For the test we always return the single fixture public
    key, so `jwt.decode` performs a genuine RS256 signature check against it —
    the verification path under test is exercised for real, only the network
    key fetch is replaced.
    """

    def __init__(self, public_key) -> None:
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token: str) -> _FakeSigningKey:  # noqa: ARG002
        return _FakeSigningKey(self._public_key)


@pytest.fixture(autouse=True)
def _local_jwks(monkeypatch):
    """Point `verify_user_pool_jwt` at the local fixture key set.

    Replaces the per-issuer JWKS client with one backed by SIGNING_PUBLIC_KEY
    and clears any audience env so the default (no audience constraint) applies.
    """
    monkeypatch.setattr(
        auth,
        "_get_jwks_client",
        lambda issuer, jwks_url=None: _FakePyJWKClient(SIGNING_PUBLIC_KEY),
    )
    monkeypatch.delenv("COGNITO_USER_POOL_CLIENT_ID", raising=False)
    auth._jwks_clients.clear()


# --- Helpers --------------------------------------------------------------


def _b64(obj: dict | bytes) -> str:
    if isinstance(obj, dict):
        obj = json.dumps(obj).encode()
    return base64.urlsafe_b64encode(obj).rstrip(b"=").decode()


def _unsigned_jwt(payload: dict) -> str:
    """Build an unsigned JWT carrying `payload` (signature is not verified).

    `build_identity_context`/`read_identity_context` never verify the token —
    verification is the callee's job — so an unsigned token is sufficient for
    the Property 5 build-side assertions and keeps the dependency surface tiny.
    """
    header = _b64({"alg": "RS256", "typ": "JWT"})
    body = _b64(payload)
    sig = _b64(b"unused-signature")
    return f"{header}.{body}.{sig}"


def _decode_sub(token: str) -> str:
    """Read the `sub` claim without verifying the signature."""
    claims = pyjwt.decode(token, options={"verify_signature": False}, algorithms=["RS256"])
    return claims.get("sub")


def _sign(payload: dict, *, key=SIGNING_KEY) -> str:
    return pyjwt.encode(payload, key, algorithm="RS256", headers={"kid": "test-key"})


# --- Property 5 -----------------------------------------------------------

_SUBS = st.text(min_size=1, max_size=64).filter(lambda s: s.strip() != "")
_FORGED_USER_IDS = st.text(max_size=64)
_ACTING_AGENTS = st.sampled_from(["ai_agent", "fraud_research", "orchestrator"])


class TestProperty5IdentityBoundToVerifiedJwt:
    """Feature: a2a-agent-collaboration, Property 5: Identity context is bound
    from the verified JWT, never from model input."""

    @settings(max_examples=200, deadline=None)
    @given(sub=_SUBS, forged_user_id=_FORGED_USER_IDS, acting_agent=_ACTING_AGENTS)
    def test_identity_context_decodes_to_verified_sub_ignoring_model_input(
        self, sub: str, forged_user_id: str, acting_agent: str
    ) -> None:
        """Feature: a2a-agent-collaboration, Property 5: Identity context is
        bound from the verified JWT, never from model input.

        For any verified `sub` and any model-supplied `user_id` (forged or
        mismatched), the built metadata's `identity_context` decodes back to
        the verified `sub`, and the model value is never what gets carried.
        """
        customer_jwt = _unsigned_jwt({"sub": sub})

        metadata = build_identity_context(customer_jwt, acting_agent=acting_agent)

        # The carried assertion is exactly the verified customer JWT, and it
        # decodes to the verified sub — independent of the forged user_id.
        assert metadata[IDENTITY_CONTEXT_KEY] == customer_jwt
        assert _decode_sub(metadata[IDENTITY_CONTEXT_KEY]) == sub
        assert read_identity_context({"metadata": metadata}) == customer_jwt
        assert _decode_sub(read_identity_context({"metadata": metadata})) == sub

        # The acting-agent id is a separate field; the model-supplied user_id
        # never lands in the identity slot (unless it coincidentally equals the
        # whole verified JWT, which the assertion below tolerates as a no-op).
        assert metadata[ACTING_AGENT_KEY] == acting_agent
        if forged_user_id != customer_jwt:
            assert metadata[IDENTITY_CONTEXT_KEY] != forged_user_id

    def test_no_user_id_seam_exists(self) -> None:
        """Feature: a2a-agent-collaboration, Property 5: Identity context is
        bound from the verified JWT, never from model input.

        `build_identity_context` accepts no `user_id` parameter, so a model can
        never supply an identity that overrides the verified JWT.
        """
        customer_jwt = _unsigned_jwt({"sub": "verified-sub"})
        with pytest.raises(TypeError):
            build_identity_context(customer_jwt, user_id="attacker-supplied")  # type: ignore[call-arg]


# --- Property 7 -----------------------------------------------------------


class TestProperty7CalleeRejectsUnverifiedIdentity:
    """Feature: a2a-agent-collaboration, Property 7: The callee rejects requests
    lacking a verified identity."""

    @settings(max_examples=200, deadline=None)
    @given(sub=_SUBS, exp_offset=st.integers(min_value=30, max_value=3600))
    def test_accepts_valid_token(self, sub: str, exp_offset: int) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity.

        A correctly-signed, unexpired token from the trusted issuer is accepted
        and its verified `sub` is returned.
        """
        now = int(time.time())
        token = _sign({"sub": sub, "iss": TEST_ISSUER, "iat": now, "exp": now + exp_offset})

        claims = verify_user_pool_jwt(token, issuer=TEST_ISSUER)

        assert claims["sub"] == sub

    @settings(max_examples=200, deadline=None)
    @given(sub=_SUBS, age=st.integers(min_value=1, max_value=100000))
    def test_rejects_expired_token(self, sub: str, age: int) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (expired token)."""
        now = int(time.time())
        token = _sign({"sub": sub, "iss": TEST_ISSUER, "iat": now - age - 10, "exp": now - age})

        with pytest.raises(IdentityVerificationError):
            verify_user_pool_jwt(token, issuer=TEST_ISSUER)

    @settings(max_examples=200, deadline=None)
    @given(sub=_SUBS, exp_offset=st.integers(min_value=30, max_value=3600))
    def test_rejects_wrong_signature(self, sub: str, exp_offset: int) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (bad signature).

        Token signed with an unrelated key; verification is against the fixture
        JWKS public key, so the signature check must fail.
        """
        now = int(time.time())
        token = _sign(
            {"sub": sub, "iss": TEST_ISSUER, "iat": now, "exp": now + exp_offset},
            key=WRONG_KEY,
        )

        with pytest.raises(IdentityVerificationError):
            verify_user_pool_jwt(token, issuer=TEST_ISSUER)

    @settings(max_examples=200, deadline=None)
    @given(garbage=st.text(max_size=80))
    def test_rejects_malformed_or_missing_token(self, garbage: str) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (malformed/absent token).

        No arbitrary string is a token validly signed by the fixture key, so
        every one is rejected — empty/whitespace strings fail the absent-token
        guard, other strings fail decoding or the signature check.
        """
        with pytest.raises(IdentityVerificationError):
            verify_user_pool_jwt(garbage, issuer=TEST_ISSUER)

    def test_rejects_missing_required_exp_claim(self) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (missing exp)."""
        token = _sign({"sub": "no-exp", "iss": TEST_ISSUER, "iat": int(time.time())})
        with pytest.raises(IdentityVerificationError):
            verify_user_pool_jwt(token, issuer=TEST_ISSUER)

    def test_rejects_wrong_issuer(self) -> None:
        """Feature: a2a-agent-collaboration, Property 7: The callee rejects
        requests lacking a verified identity (issuer mismatch)."""
        now = int(time.time())
        token = _sign({"sub": "abc", "iss": "https://evil.example/pool", "iat": now, "exp": now + 300})
        with pytest.raises(IdentityVerificationError):
            verify_user_pool_jwt(token, issuer=TEST_ISSUER)
