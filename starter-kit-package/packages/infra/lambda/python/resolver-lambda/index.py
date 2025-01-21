import boto3
from botocore.config import Config
import os
from datetime import datetime
import json
from botocore.exceptions import ClientError
from retry import retry
from concurrent.futures import ThreadPoolExecutor, as_completed
# power tools import
from aws_lambda_powertools.utilities.data_classes.appsync_resolver_event import (
    AppSyncResolverEvent
)
from aws_lambda_powertools.logging import Logger, correlation_paths

# graphQL imports
from gql_utils import gql_executor, success_response, failure_response
from gql import get_chats_by_user_id, update_chat_by_id

# Initializers
logger = Logger()

# environment variables
region_name = os.environ['AWS_REGION']
graphql_endpoint = os.environ['graphql_endpoint']
# create the bedrock runtime client
config = Config(read_timeout=1000)
bedrock_runtime = boto3.client(
    service_name="bedrock-runtime",
    region_name=region_name,
    config=config
)


def sort_by_js_date(data, date_key):
    def date_converter(obj):
        # Convert JavaScript date string to Python datetime object
        return datetime.strptime(obj[date_key], '%Y-%m-%dT%H:%M:%S.%fZ')

    return sorted(data, key=date_converter)


@logger.inject_lambda_context(correlation_id_path=correlation_paths.APPSYNC_RESOLVER, log_event=True)
def lambda_handler(event, context):

    app_sync_event: AppSyncResolverEvent = AppSyncResolverEvent(event)
    print(app_sync_event)

    arguments = app_sync_event.arguments.get("args")
    host = app_sync_event.request_headers.get("host")
    auth_token = app_sync_event.request_headers.get("authorization")
    api_key = app_sync_event.request_headers.get("x-api-key")
    # load the args and augment with other key information from request
    args = json.loads(arguments)
    args["host"] = host
    args["auth_token"] = auth_token
    args["api_key"] = api_key
    logger.info(args)

    try:
        if args["opr"] == "chat":
            # get the chat from its user id
            chat_response = gql_executor(graphql_endpoint,
                                         host=args["host"],
                                         auth_token=args["auth_token"],
                                         api_key=None,
                                         payload={
                                             "query":  get_chats_by_user_id,
                                             "variables": {
                                                 "userID": args["userID"],
                                             }
                                         })
            all_chats = sort_by_js_date(
                chat_response["data"]["chatsByUserID"]["items"], "createdAt")
            # get only last 10 chats for history
            chats = all_chats[-10:]
            print(chats)
            history = []
            for item in chats:
                history.append({
                    "role": "user",
                    "content": item["human"]
                })
                history.append({
                    "role": "assistant",
                    "content": item["bot"]
                })
            # remove last object in history as that is the assistants turn
            history.pop()
            print(history)
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 4096,
                "temperature": 0.5,
                "top_k": 250,
                "top_p": 1,
                "stop_sequences": [],
                "system": "You are Claude, an AI assistant created by Anthropic to be helpful,harmless, and honest. Your goal is to provide informative and substantive responses to queries while avoiding potential harms.",
                "messages": history
            })
            print(body)

            # submit the chat with history and rest chat
            response = bedrock_runtime.invoke_model_with_response_stream(
                modelId="anthropic.claude-3-5-haiku-20241022-v1:0",
                body=body,
                accept='application/json'
            )
            bot_response = ''
            metrics = {}
            for event in response.get("body"):
                chunk = json.loads(event["chunk"]["bytes"])

                if chunk['type'] == 'message_delta':
                    print(f"\nStop reason: {chunk['delta']['stop_reason']}")
                    print(f"Stop sequence: {chunk['delta']['stop_sequence']}")
                    print(f"Output tokens: {chunk['usage']['output_tokens']}")
                    metrics["total_tokens"] = chunk['usage']['output_tokens']
                    metrics["stop_reason"] = chunk['delta']['stop_reason']
                    metrics["stop_sequence"] = chunk['delta']['stop_sequence']

                if chunk['type'] == 'content_block_delta':
                    if chunk['delta']['type'] == 'text_delta':
                        print(chunk['delta']['text'], end="")
                        bot_response += chunk['delta']['text']
                    else:
                        print(chunk['delta'], end="")

                # send an update to gql this will trigger subscriptions on UI
                gql_executor(graphql_endpoint,
                             host=args["host"],
                             auth_token=args["auth_token"],
                             api_key=None,
                             payload={
                                 "query":  update_chat_by_id,
                                 "variables": {
                                     "input": {
                                         "id": args["id"],
                                         "userID": args["userID"],
                                         "human": args["message"],
                                         "bot": bot_response,
                                         "data": json.dumps(metrics),
                                     },

                                 }
                             })
        elif args["opr"] == "todo":
            # do something else
            print("Hello from Todo!")
        # your operations here such as calling Bedrock APIs
        return success_response("Appsync resolver success")
    # generate a catch block
    except Exception as e:
        logger.error(e)
        return failure_response("Appsync resolver error")
