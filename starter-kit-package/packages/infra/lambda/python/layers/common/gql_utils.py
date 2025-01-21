import json
# imports from common layer
import requests
from aws_lambda_powertools.logging import Logger

logger = Logger()


def failure_response(error_message):
    return {"success": False, "errorMessage": error_message, "statusCode": "400"}


def success_response(result):
    return {"success": True, "result": result, "statusCode": "200"}


def gql_executor(endpoint, host, auth_token, api_key, payload):
    
    logger.info(f"GQL payload - {payload}")
    headers = {
        # 'host': host,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }

    if auth_token is not None:
        headers['Authorization'] = "Bearer " + auth_token
        headers['host'] = host
    if api_key is not None:
        headers['x-api-key'] = api_key

    try:
        response = requests.post(
            endpoint,
            headers=headers,
            json=payload
        )
        # logger.info(f"GQL response - {response.json()}")
        return response.json()
    except Exception as e:
        print(f"error in gql-executor - {e} ")
        failure_response(e)
