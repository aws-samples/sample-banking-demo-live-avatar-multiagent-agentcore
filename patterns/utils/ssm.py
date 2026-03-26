"""
SSM Parameter Store utilities for agent patterns.

Provides a single shared function for fetching parameters from AWS SSM
Parameter Store, used by agents to retrieve configuration values like
Gateway URLs that are set during deployment.

Parameters are cached for the lifetime of the container to avoid repeated
API calls on every request.
"""

import logging
import os

import boto3

logger = logging.getLogger(__name__)

# Module-level cache: SSM params don't change during a container's lifetime
_ssm_cache: dict[str, str] = {}
_ssm_client = None


def _get_ssm_client():
    """Get or create a reusable SSM client."""
    global _ssm_client
    if _ssm_client is None:
        region = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
        _ssm_client = boto3.client("ssm", region_name=region)
    return _ssm_client


def get_ssm_parameter(parameter_name: str) -> str:
    """
    Fetch a parameter value from AWS SSM Parameter Store.

    Results are cached for the lifetime of the container since SSM parameters
    (Gateway URLs, guardrail IDs, etc.) don't change between deployments.

    Args:
        parameter_name (str): The full SSM parameter name/path
            (e.g. '/my-stack/gateway_url').

    Returns:
        str: The parameter value.

    Raises:
        ValueError: If the parameter is not found or cannot be retrieved.
    """
    if parameter_name in _ssm_cache:
        return _ssm_cache[parameter_name]

    ssm = _get_ssm_client()
    try:
        response = ssm.get_parameter(Name=parameter_name)
        value = response["Parameter"]["Value"]
        _ssm_cache[parameter_name] = value
        return value
    except ssm.exceptions.ParameterNotFound:
        raise ValueError(f"SSM parameter not found: {parameter_name}")
    except Exception as e:
        raise ValueError(f"Failed to retrieve SSM parameter {parameter_name}: {e}")
