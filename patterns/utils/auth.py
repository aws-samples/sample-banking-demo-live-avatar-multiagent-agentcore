"""
Authentication utilities for agent patterns.

Provides:
- Secure user identity extraction from JWT tokens in the AgentCore Runtime
  RequestContext (prevents impersonation via prompt injection).
- Cryptographic verification of a forwarded customer user-pool JWT
  (`verify_user_pool_jwt`) for the callee side of the A2A hop, distinct from the
  signature-skipping `extract_user_id_from_token`.
- OAuth2 client credentials flow for machine-to-machine Gateway authentication,
  generalized so a caller can mint a token for an arbitrary configured client.

OAuth tokens are cached and reused until they expire, avoiding redundant
Cognito round-trips on every request. User-pool JWKS clients are cached per
issuer so signature verification does not re-fetch the key set on every call.
"""

import base64
import logging
import os
import time

import boto3
import jwt
import requests
from bedrock_agentcore.runtime import RequestContext

from utils.ssm import get_ssm_parameter

logger = logging.getLogger(__name__)

# Module-level per-client OAuth token cache, keyed by the client-id SSM
# parameter name. Each entry is {"access_token": str, "expires_at": float}.
_token_cache: dict[str, dict[str, object]] = {}
_secrets_client = None

# Module-level cache of PyJWKClient instances keyed by issuer. PyJWKClient
# fetches and caches the JWKS itself; caching the client keeps the key set warm
# across requests within a container instead of re-fetching per verification.
_jwks_clients: dict[str, "jwt.PyJWKClient"] = {}


# Sentinel the identity-provider custom resource emits when provisioning
# failed; treated the same as "identity not configured".
_IDENTITY_UNAVAILABLE = "agentcore-identity-unavailable"
_agentcore_identity_client = None

# Last platform-injected workload access token. The AgentCore Runtime injects
# it per request into a ContextVar (BedrockAgentCoreContext), which does NOT
# propagate to plain worker threads (the research pipeline runs in one). Stash
# the most recent token at module level so background work can still exchange
# it. Workload tokens are short-lived; a stale one fails the exchange and the
# caller falls back to the direct Cognito path.
_last_workload_token: str | None = None


class IdentityVerificationError(Exception):
    """Raised when a forwarded customer identity JWT cannot be verified.

    Covers an absent token, a malformed token, an expired token, a bad
    signature, and issuer/audience mismatches. The callee maps this to a
    JSON-RPC authorization error and never runs the assessment.
    """


def _get_secrets_client():
    """Get or create a reusable Secrets Manager client."""
    global _secrets_client
    if _secrets_client is None:
        region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
        _secrets_client = boto3.client("secretsmanager", region_name=region)
    return _secrets_client


def extract_user_id_from_token(token: str) -> str:
    """
    Extract the Cognito `sub` claim from a JWT without verifying its signature.

    This function assumes the token has ALREADY been validated by an upstream
    authenticator (AgentCore Runtime's JWT authorizer for HTTP/SSE, Cognito
    Identity Pool's credential issuance for WebSocket). The function is
    transport-agnostic; callers on HTTP/SSE use `extract_user_id_from_context`,
    WebSocket callers pass the ID token received in the first `sessionStart`
    JSON message (query-string params are not forwarded by the AgentCore
    Runtime WebSocket proxy).

    Args:
        token: Raw JWT string (no "Bearer " prefix). Must contain a `sub` claim.

    Returns:
        The user ID (sub claim).

    Raises:
        ValueError: If token is empty, malformed, or missing the `sub` claim.
    """
    if not token:
        raise ValueError("Empty JWT token passed to extract_user_id_from_token")

    # Decode without signature verification — upstream already validated.
    try:
        claims = jwt.decode(
            jwt=token,
            # AgentCore Runtime's OIDC authorizer has already validated this
            # JWT's signature before the request reaches the agent, and the
            # token is read out of the authorizer-populated request context —
            # not from a caller-supplied payload. Re-verifying would mean
            # fetching the JWKS per invocation for a check AgentCore already
            # owns. Any path that accepts a CLIENT-SUPPLIED token must use
            # verify_user_pool_jwt instead (see the avatar WebSocket).
            # nosemgrep: unverified-jwt-decode
            options={"verify_signature": False},
            algorithms=["RS256"],
        )
    except jwt.PyJWTError as exc:
        raise ValueError(f"Failed to decode JWT: {exc}") from exc

    user_id = claims.get("sub")
    if not user_id:
        raise ValueError("JWT token does not contain a 'sub' claim. Cannot determine user identity.")

    logger.info("Extracted user_id from JWT: %s", user_id)
    return user_id


def extract_user_id_from_context(context: RequestContext) -> str:
    """
    Securely extract the user ID from the JWT token in the request context.

    AgentCore Runtime validates the JWT token before passing it to the agent,
    so we can safely skip signature verification here. The user ID is taken
    from the token's 'sub' claim rather than from the request payload, which
    prevents impersonation via prompt injection.

    Args:
        context (RequestContext): The request context provided by AgentCore
            Runtime, containing validated request headers including the
            Authorization JWT.

    Returns:
        str: The user ID (sub claim) extracted from the validated JWT token.

    Raises:
        ValueError: If the Authorization header is missing or the JWT does
            not contain a 'sub' claim.
    """
    request_headers = context.request_headers
    if not request_headers:
        raise ValueError(
            "No request headers found in context. "
            "Ensure the Runtime is configured with a request header allowlist "
            "that includes the Authorization header."
        )

    auth_header = request_headers.get("Authorization")
    if not auth_header:
        raise ValueError(
            "No Authorization header found in request context. "
            "Ensure the Runtime is configured with JWT inbound auth "
            "and the Authorization header is in the request header allowlist."
        )

    # Remove "Bearer " prefix to get the raw JWT token
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else auth_header
    return extract_user_id_from_token(token)


def get_secret(secret_name: str) -> str:
    """
    Fetch a secret value from AWS Secrets Manager.

    Secrets Manager is designed for storing sensitive information like passwords,
    API keys, and other secrets with automatic rotation capabilities.

    Args:
        secret_name (str): The name or ARN of the secret to retrieve.

    Returns:
        str: The secret value as a string.

    Raises:
        ValueError: If the secret is not found or cannot be accessed.
        RuntimeError: If there's an AWS service error.
    """
    secrets_client = _get_secrets_client()

    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        return response["SecretString"]
    except secrets_client.exceptions.ResourceNotFoundException:
        raise ValueError(f"Secret not found: {secret_name}")
    except secrets_client.exceptions.InvalidParameterException:
        raise ValueError(f"Invalid secret parameter: {secret_name}")
    except secrets_client.exceptions.InvalidRequestException:
        raise ValueError(f"Invalid request for secret: {secret_name}")
    except secrets_client.exceptions.DecryptionFailureException:
        raise RuntimeError(f"Failed to decrypt secret: {secret_name}")
    except secrets_client.exceptions.InternalServiceErrorException:
        raise RuntimeError(f"AWS Secrets Manager service error for secret: {secret_name}")
    except Exception as e:
        raise RuntimeError(f"Unexpected error retrieving secret {secret_name}: {str(e)}")


def _get_agentcore_identity_client():
    """Get or create a reusable AgentCore Identity data-plane client."""
    global _agentcore_identity_client
    if _agentcore_identity_client is None:
        region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
        _agentcore_identity_client = boto3.client("bedrock-agentcore", region_name=region)
    return _agentcore_identity_client


def _identity_env() -> tuple[str, str] | None:
    """Return (provider_name, workload_name) when the Identity path is configured.

    Both env vars are injected by the Backend stack only when
    `features.agentcore_identity` is on AND the credential-provider custom
    resource provisioned successfully; the UNAVAILABLE sentinel (best-effort
    provisioning failure) is treated as not configured.
    """
    provider = os.environ.get("AGENTCORE_IDENTITY_PROVIDER")
    workload = os.environ.get("AGENTCORE_WORKLOAD_NAME")
    if not provider or not workload or provider == _IDENTITY_UNAVAILABLE:
        return None
    return provider, workload


def _get_workload_token() -> str:
    """Resolve this runtime's workload access token.

    Preferred source is the token the AgentCore Runtime injects per request
    (BedrockAgentCoreContext ContextVar, populated from the
    WorkloadAccessToken header after inbound JWT auth) — no API call needed.
    A module-level stash covers background threads the ContextVar doesn't
    reach. As a last resort, exchange by workload name via
    GetWorkloadAccessToken (works only if AGENTCORE_WORKLOAD_NAME matches an
    existing workload identity name).
    """
    global _last_workload_token
    try:
        from bedrock_agentcore.runtime.context import BedrockAgentCoreContext

        token = BedrockAgentCoreContext.get_workload_access_token()
        if token:
            _last_workload_token = token
            return token
    except Exception as exc:  # noqa: BLE001 - context lookup is best effort
        logger.debug("Workload token context lookup failed: %s", exc)

    if _last_workload_token:
        return _last_workload_token

    _, workload = _identity_env() or (None, None)
    if not workload:
        raise RuntimeError("No workload access token available on this runtime")
    client = _get_agentcore_identity_client()
    return client.get_workload_access_token(workloadName=workload)["workloadAccessToken"]


def _get_token_via_agentcore_identity(scope: str) -> str:
    """Mint a Gateway access token through AgentCore Identity (token vault).

    Exchanges this runtime's platform-issued workload access token for an
    OAuth2 M2M token via the configured credential provider
    (GetResourceOauth2Token). The provider holds the same Cognito
    machine-client credentials the direct path uses, so the resulting bearer
    is the same JWT the Gateway already accepts — the difference is that
    minting now flows through AgentCore Identity (visible in the Identity
    console/token vault).

    Tokens are cached per provider until 60 seconds before their `exp` claim.

    Raises:
        Exception: On any Identity API failure — callers fall back to the
            direct Cognito path.
    """
    provider, _workload = _identity_env() or (None, None)
    if not provider:
        raise RuntimeError("AgentCore Identity is not configured on this runtime")

    cache_key = f"identity:{provider}"
    cached = _token_cache.get(cache_key)
    if cached and cached.get("access_token") and cached.get("expires_at", 0) > time.time():
        logger.info(
            "Using cached AgentCore Identity token (expires in %ds)",
            int(cached["expires_at"] - time.time()),
        )
        return cached["access_token"]

    client = _get_agentcore_identity_client()
    workload_token = _get_workload_token()
    response = client.get_resource_oauth2_token(
        workloadIdentityToken=workload_token,
        resourceCredentialProviderName=provider,
        scopes=scope.split(),
        oauth2Flow="M2M",
    )
    access_token = response["accessToken"]

    # Cache until shortly before the token's own expiry (Cognito access tokens
    # carry `exp`); fall back to a conservative 5 minutes if it can't be read.
    # This decode reads `exp` ONLY to pick a cache TTL — it makes no security
    # decision and no identity claim. The token was just returned by the
    # AgentCore Identity API in this same call, so it is not attacker-supplied;
    # an unreadable or tampered value simply falls back to the 5-minute TTL.
    try:
        # nosemgrep: unverified-jwt-decode
        claims = jwt.decode(jwt=access_token, options={"verify_signature": False}, algorithms=["RS256"])
        expires_at = float(claims["exp"]) - 60
    except Exception:  # noqa: BLE001 - opaque/undecodable token
        expires_at = time.time() + 300
    _token_cache[cache_key] = {"access_token": access_token, "expires_at": expires_at}

    logger.info("Minted Gateway token via AgentCore Identity provider '%s'", provider)
    return access_token


def get_agent_access_token(client_id_param: str, secret_param: str, *, scope: str | None = None) -> str:
    """
    Mint an OAuth2 access token via client credentials for an arbitrary client.

    Generalizes the machine-to-machine flow so a caller can obtain a token for
    any configured Cognito app client — the shared machine client, the fraud
    agent's own client, etc. — by pointing at that client's SSM parameter and
    Secrets Manager secret. This is what lets the fraud agent reach the Gateway
    as a *distinct principal* from the account-opening agent.

    Tokens are cached per `client_id_param` and reused until 60 seconds before
    expiry, avoiding redundant Cognito round-trips under sustained load.

    Args:
        client_id_param: SSM parameter name holding the Cognito app client id
            (e.g. `/my-stack/machine_client_id`).
        secret_param: Secrets Manager secret name holding the client secret
            (e.g. `/my-stack/machine_client_secret`).
        scope: OAuth2 scope string. Defaults to the stack's gateway read+write
            scopes (`<stack>-gateway/read <stack>-gateway/write`).

    Returns:
        str: A valid OAuth2 access token for the requested client.

    Raises:
        KeyError: If the STACK_NAME environment variable is not set.
        Exception: If the token request fails or the response is invalid.
    """
    # AgentCore Identity path (features.agentcore_identity): only the shared
    # machine client is stored in the Identity credential provider, so route
    # just that client through the token vault. Any Identity failure falls
    # back to the proven direct-Cognito flow below so nothing breaks.
    if client_id_param.endswith("machine_client_id") and _identity_env():
        stack = os.environ.get("STACK_NAME", "")
        identity_scope = scope or f"{stack}-gateway/read {stack}-gateway/write"
        try:
            return _get_token_via_agentcore_identity(identity_scope)
        except Exception as exc:  # noqa: BLE001 - fall back to the direct path
            logger.warning("AgentCore Identity token path failed, falling back to direct Cognito: %s", exc)

    # Return cached token for this client if still valid (with 60s safety margin)
    cached = _token_cache.get(client_id_param)
    if cached and cached.get("access_token") and cached.get("expires_at", 0) > time.time():
        logger.info(
            "Using cached access token for %s (expires in %ds)",
            client_id_param,
            int(cached["expires_at"] - time.time()),
        )
        return cached["access_token"]

    stack_name = os.environ["STACK_NAME"]
    region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

    logger.info("Getting access token for stack: %s, region: %s, client_param: %s", stack_name, region, client_id_param)

    # Get Cognito configuration from SSM and Secrets Manager
    cognito_domain = get_ssm_parameter(f"/{stack_name}/cognito_provider")
    client_id = get_ssm_parameter(client_id_param)
    client_secret = get_secret(secret_param)

    resolved_scope = scope or f"{stack_name}-gateway/read {stack_name}-gateway/write"

    logger.info("Cognito domain: %s", cognito_domain)
    logger.info("Client ID: %s...", client_id[:10])

    # Prepare OAuth2 token request
    token_url = f"https://{cognito_domain}/oauth2/token"

    # Create Basic Auth header (base64-encoded client_id:client_secret)
    credentials = f"{client_id}:{client_secret}"
    b64_credentials = base64.b64encode(credentials.encode()).decode()

    headers = {
        "Authorization": f"Basic {b64_credentials}",
        "Content-Type": "application/x-www-form-urlencoded",
    }

    data = {
        "grant_type": "client_credentials",
        "scope": resolved_scope,
    }

    logger.info("Requesting token from: %s", token_url)
    logger.info("Scopes: %s", data["scope"])

    # Request access token from Cognito
    response = requests.post(url=token_url, headers=headers, data=data, timeout=300)

    if response.status_code != 200:
        logger.error("Token request failed: %s", response.status_code)
        logger.error("Response: %s", response.text)
        raise Exception(f"Failed to get access token: {response.status_code} - {response.text}")

    token_data = response.json()
    access_token = token_data.get("access_token")

    if not access_token:
        logger.error("No access_token in response: %s", token_data)
        raise Exception("No access_token in Cognito response")

    # Cache the token with expiry (default 3600s, subtract 60s safety margin)
    expires_in = token_data.get("expires_in", 3600)
    _token_cache[client_id_param] = {
        "access_token": access_token,
        "expires_at": time.time() + expires_in - 60,
    }

    logger.info(
        "Successfully got access token for %s (expires in %ds): %s...",
        client_id_param,
        expires_in,
        access_token[:20],
    )
    return access_token


def get_gateway_access_token() -> str:
    """
    Get an OAuth2 access token for the shared machine (Gateway) client.

    Thin wrapper over `get_agent_access_token` that resolves the shared machine
    client's SSM parameter and secret from the STACK_NAME environment variable.

    Returns:
        str: A valid OAuth2 access token for Gateway authentication.

    Raises:
        KeyError: If the STACK_NAME environment variable is not set.
        Exception: If the token request fails or the response is invalid.
    """
    stack_name = os.environ["STACK_NAME"]
    return get_agent_access_token(
        f"/{stack_name}/machine_client_id",
        f"/{stack_name}/machine_client_secret",
    )


def _get_user_pool_issuer(issuer: str | None) -> str:
    """Resolve the Cognito user-pool issuer URL from an override or the env.

    Prefers an explicit `issuer`, then `COGNITO_USER_POOL_ISSUER`, then derives
    it from `COGNITO_USER_POOL_ID` + region as
    `https://cognito-idp.<region>.amazonaws.com/<user_pool_id>`.
    """
    if issuer:
        return issuer.rstrip("/")

    env_issuer = os.environ.get("COGNITO_USER_POOL_ISSUER")
    if env_issuer:
        return env_issuer.rstrip("/")

    user_pool_id = os.environ.get("COGNITO_USER_POOL_ID")
    if user_pool_id:
        region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
        return f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"

    raise IdentityVerificationError(
        "No user-pool issuer configured. Set COGNITO_USER_POOL_ISSUER or "
        "COGNITO_USER_POOL_ID, or pass issuer= explicitly."
    )


def _get_jwks_client(issuer: str, jwks_url: str | None) -> "jwt.PyJWKClient":
    """Get or create a JWKS client for `issuer`, cached per issuer."""
    if issuer in _jwks_clients:
        return _jwks_clients[issuer]

    url = jwks_url or f"{issuer}/.well-known/jwks.json"
    client = jwt.PyJWKClient(url)
    _jwks_clients[issuer] = client
    return client


def verify_user_pool_jwt(
    token: str,
    *,
    issuer: str | None = None,
    audience: str | None = None,
    jwks_url: str | None = None,
) -> dict:
    """
    Cryptographically verify a forwarded customer Cognito user-pool JWT.

    Unlike `extract_user_id_from_token` — which trusts an upstream authenticator
    and skips signature verification — this is the *callee* side of the A2A hop:
    the fraud-research agent receives a customer assertion forwarded by another
    agent, so it must independently verify it. Verification fetches the user
    pool's JWKS, checks the RS256 signature, the issuer, expiry (`exp`), and the
    audience, and returns the decoded claims.

    Cognito id tokens carry `aud`; access tokens carry `client_id` instead. When
    an audience is configured, a match on *either* claim is accepted so both
    token types verify correctly.

    Configuration is resolved from keyword overrides first, then the
    environment (`COGNITO_USER_POOL_ISSUER`/`COGNITO_USER_POOL_ID`,
    `COGNITO_USER_POOL_CLIENT_ID`). The overrides make the function testable
    against a local key/JWKS fixture.

    Args:
        token: Raw compact JWT string (no "Bearer " prefix).
        issuer: Optional issuer URL override.
        audience: Optional expected audience/client-id override.
        jwks_url: Optional JWKS URL override (defaults to
            `<issuer>/.well-known/jwks.json`).

    Returns:
        dict: The verified JWT claims.

    Raises:
        IdentityVerificationError: If the token is absent, malformed, expired,
            has a bad signature, or fails issuer/audience verification.
    """
    if not token or not token.strip():
        raise IdentityVerificationError("Absent customer identity JWT")

    resolved_issuer = _get_user_pool_issuer(issuer)
    resolved_audience = audience if audience is not None else os.environ.get("COGNITO_USER_POOL_CLIENT_ID")

    try:
        jwks_client = _get_jwks_client(resolved_issuer, jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        # Verify signature, issuer, and expiry. Audience is checked manually
        # below so both `aud` (id tokens) and `client_id` (access tokens) work.
        claims = jwt.decode(
            jwt=token,
            key=signing_key.key,
            algorithms=["RS256"],
            issuer=resolved_issuer,
            options={"verify_aud": False, "require": ["exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise IdentityVerificationError(f"Expired customer identity JWT: {exc}") from exc
    except jwt.InvalidIssuerError as exc:
        raise IdentityVerificationError(f"Invalid issuer on customer identity JWT: {exc}") from exc
    except jwt.PyJWKClientError as exc:
        raise IdentityVerificationError(f"Could not resolve signing key for customer identity JWT: {exc}") from exc
    except jwt.InvalidTokenError as exc:
        # Covers bad signature, malformed token, missing required claims, etc.
        raise IdentityVerificationError(f"Invalid customer identity JWT: {exc}") from exc

    if resolved_audience is not None:
        token_audience = claims.get("aud")
        token_client_id = claims.get("client_id")
        audiences = token_audience if isinstance(token_audience, list) else [token_audience]
        if resolved_audience not in audiences and resolved_audience != token_client_id:
            raise IdentityVerificationError(
                "Customer identity JWT audience does not match the expected user-pool client"
            )

    if not claims.get("sub"):
        raise IdentityVerificationError("Verified customer identity JWT does not contain a 'sub' claim")

    logger.info("Verified customer identity JWT for sub: %s", claims.get("sub"))
    return claims
