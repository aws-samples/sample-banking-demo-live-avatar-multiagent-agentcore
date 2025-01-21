import json


def handler(event, context):
    print("received event:")
    print(event)
    data = {"message": "Hello from Python Lambda!"}
    return {
        'statusCode': 200,
        'headers': {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(data)
    }
