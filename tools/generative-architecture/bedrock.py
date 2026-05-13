"""
Thin wrapper around the AWS Bedrock Converse API for Claude calls.

Model IDs and region come from `constants.py` so callers can swap models
without editing this file. By default we use Claude Sonnet 4.5 via a
US-region CRIS inference profile, with a global-profile fallback.
"""

import sys

import boto3
from botocore.config import Config

# Claude Sonnet 4.5/4.6 generating a ~70-edge diagrams.py script routinely
# exceeds botocore's default 60s read_timeout. Bump to 5 minutes.
_BEDROCK_CONFIG = Config(read_timeout=300, connect_timeout=10, retries={"max_attempts": 2})


def ask_claude(question):
    """Query Claude via Bedrock Converse and return the response text.

    Tries the regional CRIS profile first; falls back to the global profile
    if the regional call fails (common when the caller's AWS account has
    model access only on one path).
    """

    from constants import AWS_REGION, MODEL_ID_REGIONAL

    bedrock = boto3.client(
        service_name="bedrock-runtime",
        region_name=AWS_REGION,
        config=_BEDROCK_CONFIG,
    )
    model_id = MODEL_ID_REGIONAL

    from constants import CLAUDE_MAX_TOKENS, CLAUDE_TEMPERATURE

    try:
        response = bedrock.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": question}]}],
            inferenceConfig={
                "maxTokens": CLAUDE_MAX_TOKENS,
                "temperature": CLAUDE_TEMPERATURE,
            },
        )

        response_text = response["output"]["message"]["content"][0]["text"]
        print(response_text)
        return response_text

    except Exception as e:
        error_type = type(e).__name__
        print(f"Error calling Claude [{error_type}] via {model_id}: {e}")

        lowered = str(e).lower()
        if "throttl" in lowered:
            print("  → Rate limit exceeded. Please wait and try again.")
        elif "access" in lowered or "denied" in lowered:
            print("  → Access denied. Check IAM permissions for Bedrock model access.")
        elif "not found" in lowered:
            print("  → Model not found. Ensure model access is enabled in Bedrock console.")

        print("Attempting with global endpoint...")

        try:
            from constants import MODEL_ID_GLOBAL

            model_id = MODEL_ID_GLOBAL
            response = bedrock.converse(
                modelId=model_id,
                messages=[{"role": "user", "content": [{"text": question}]}],
                inferenceConfig={
                    "maxTokens": CLAUDE_MAX_TOKENS,
                    "temperature": CLAUDE_TEMPERATURE,
                },
            )

            response_text = response["output"]["message"]["content"][0]["text"]
            print(response_text)
            return response_text

        except Exception as e2:
            error_type2 = type(e2).__name__
            print(f"Error with global endpoint [{error_type2}]: {e2}")
            print("\n⚠️  Both regional and global endpoints failed.")
            print("Check:")
            print("  1. AWS credentials are configured (AWS_PROFILE or default credentials)")
            print("  2. Model access is enabled in Bedrock console (us-east-1 region)")
            print("  3. IAM permissions include bedrock:InvokeModel")
            raise


if __name__ == "__main__":
    ask_claude(sys.argv[1])
