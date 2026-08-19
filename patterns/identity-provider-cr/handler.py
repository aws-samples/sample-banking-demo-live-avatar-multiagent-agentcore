# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""CDK custom-resource handler that provisions an AgentCore Identity OAuth2
credential provider for the Gateway's Cognito M2M client.

There is no CloudFormation resource for AgentCore Identity credential
providers, so this Lambda calls the `bedrock-agentcore-control` APIs on the
stack's behalf. The provider stores the Cognito machine-client credentials in
the AgentCore Identity token vault; agents then obtain Gateway tokens through
Identity (GetWorkloadAccessToken -> GetResourceOauth2Token) instead of calling
the Cognito token endpoint themselves — which is what makes the AgentCore
Identity console (workload identities, credential providers, token vault) show
the demo's auth in active use.

SECURITY: the client secret is read INSIDE this Lambda from Secrets Manager
(the secret name rides in as a property, never the value), so the secret never
appears in CloudFormation properties/events.

Best-effort by design: a provisioning failure returns an UNAVAILABLE sentinel
rather than failing the deploy — the agent code falls back to the existing
direct-Cognito path — and Delete always reports success so a stack delete is
never blocked.
"""

from __future__ import annotations

import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")
UNAVAILABLE = "agentcore-identity-unavailable"


def _control():
    return boto3.client("bedrock-agentcore-control", region_name=REGION)


def _error_code(exc: ClientError) -> str:
    return exc.response.get("Error", {}).get("Code", "")


def _read_client_credentials(props: dict[str, Any]) -> tuple[str, str]:
    """Read the Cognito client id (SSM) and secret (Secrets Manager) by name."""
    ssm = boto3.client("ssm", region_name=REGION)
    secrets = boto3.client("secretsmanager", region_name=REGION)
    client_id = ssm.get_parameter(Name=props["ClientIdParam"])["Parameter"]["Value"]
    client_secret = secrets.get_secret_value(SecretId=props["ClientSecretName"])["SecretString"]
    return client_id, client_secret


def _provider_config(client_id: str, client_secret: str, discovery_url: str) -> dict[str, Any]:
    """CustomOauth2 config: Cognito via its OIDC discovery document."""
    return {
        "customOauth2ProviderConfig": {
            "clientId": client_id,
            "clientSecret": client_secret,
            "oauthDiscovery": {"discoveryUrl": discovery_url},
        }
    }


def _find_provider(client, name: str) -> bool:
    try:
        params: dict = {}
        while True:
            resp = client.list_oauth2_credential_providers(**params)
            for item in resp.get("credentialProviders", []):
                if item.get("name") == name:
                    return True
            token = resp.get("nextToken")
            if not token:
                return False
            params = {"nextToken": token}
    except Exception as exc:  # noqa: BLE001 - discovery is best effort
        print(f"[IDENTITY] list providers failed: {exc}")
        return False


def _on_create_update(props: dict[str, Any]) -> dict[str, Any]:
    name = props["ProviderName"]
    discovery_url = props["DiscoveryUrl"]
    client = _control()

    try:
        client_id, client_secret = _read_client_credentials(props)
        config = _provider_config(client_id, client_secret, discovery_url)

        if _find_provider(client, name):
            # Rotate/refresh in place so an Update rerun converges.
            client.update_oauth2_credential_provider(
                name=name,
                credentialProviderVendor="CustomOauth2",
                oauth2ProviderConfigInput=config,
            )
            print(f"[IDENTITY] updated provider '{name}'")
        else:
            client.create_oauth2_credential_provider(
                name=name,
                credentialProviderVendor="CustomOauth2",
                oauth2ProviderConfigInput=config,
            )
            print(f"[IDENTITY] created provider '{name}'")
        return {"PhysicalResourceId": name, "Data": {"ProviderName": name}}
    except Exception as exc:  # noqa: BLE001 - never fail the deploy; agents fall back
        print(f"[IDENTITY] provisioning failed, agents will use the direct path: {exc}")
        return {"PhysicalResourceId": UNAVAILABLE, "Data": {"ProviderName": UNAVAILABLE}}


def _on_delete(physical_id: str) -> dict[str, Any]:
    if physical_id and physical_id != UNAVAILABLE:
        try:
            _control().delete_oauth2_credential_provider(name=physical_id)
            print(f"[IDENTITY] deleted provider '{physical_id}'")
        except ClientError as exc:
            if _error_code(exc) != "ResourceNotFoundException":
                print(f"[IDENTITY] delete failed (ignored): {exc}")
        except Exception as exc:  # noqa: BLE001 - never block a destroy
            print(f"[IDENTITY] delete failed (ignored): {exc}")
    return {"PhysicalResourceId": physical_id or UNAVAILABLE}


def on_event(event, _context):
    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {}) or {}
    print(f"[IDENTITY] {request_type} for '{props.get('ProviderName')}' in {REGION}")

    if request_type in ("Create", "Update"):
        return _on_create_update(props)
    if request_type == "Delete":
        return _on_delete(event.get("PhysicalResourceId", ""))
    return {"PhysicalResourceId": event.get("PhysicalResourceId", UNAVAILABLE)}
