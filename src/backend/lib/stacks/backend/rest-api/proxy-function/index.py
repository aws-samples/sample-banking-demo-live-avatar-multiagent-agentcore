import json
import os

from aws_lambda_powertools import Logger
from aws_lambda_powertools.event_handler import APIGatewayRestResolver
from aws_lambda_powertools.event_handler.api_gateway import CORSConfig
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = Logger()
app = APIGatewayRestResolver(
    cors=CORSConfig(
        allow_origin="",
        extra_origins=json.loads(os.environ["ALLOWED_ORIGINS"]),
        allow_credentials=True,
    )
)


@app.post("/message")
def post_message():
    email = app.current_event.request_context.authorizer.claims.get("email")
    data = app.current_event.json_body
    return {"content": f'{email} said "{data}".', "type": "success"}


@app.delete("/message")
def delete_message():
    return {"content": "Message deleted.", "type": "success"}


@logger.inject_lambda_context
def handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
