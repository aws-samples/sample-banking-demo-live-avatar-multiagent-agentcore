# Genesis Gateway AWS Authentication Instructions

This guide explains how to use the AWS cli for making authenticated requests to the Genesis Gateway API.

## Prerequisites

1. **AWS Credentials**: Ensure your AWS credentials are configured
2. **Account Allowlisting**: Your AWS account must be added to the Genesis Gateway beta allowlist
3. **Required Permissions**: Your IAM role/user needs the following permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": [
                "genesis-test:*",
                "genesis:*",
                "iam:PassRole"
            ],
            "Resource": "*"
        }
    ]
}
```
  4. **Trust Role on the login account**

  ```json
        {
              "Effect": "Allow",
              "Principal": {
                  "AWS": "arn:aws:iam::996756280381:root"
              },
              "Action": "sts:AssumeRole"
          }
  ```

## Setup

Use the `awscurl` cli utility to call after logging in from the allowlisted account.

## Usage

### with awscurl
```bash
awscurl -X PUT -H "Content-Type: application/json" https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways --data '{"name": "HelloWorldMCPGatewayBetaTest","protocolType": "MCP","roleArn": "arn:aws:iam::652238464767:role/Admin","description": "One stop shop for managing your listings"}' --service genesis-test --region us-west-2
```

### Parameters

- `METHOD`: HTTP method (GET, POST, PUT, DELETE)
- `URL`: Full URL to the Genesis Gateway API endpoint
- `JSON_DATA`: Optional JSON payload for requests that require data

## Common Operations

### 1. Create a Gateway
```bash
awscurl -X PUT -H "Content-Type: application/json" https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways --data '{"name": "HelloWorldMCPGatewayBetaTest","protocolType": "MCP","roleArn": "arn:aws:iam::315761230293:role/Admin","description": "One stop shop for managing your listings"}' --service genesis-test --region us-west-2
```

**Expected Response:**
```json
{"arn":"arn:aws:genesis:us-west-2:315761230293:gateway/XDQQHFVPXL","createdAt":"2025-06-12T19:15:37.785880286Z","description":"One stop shop for managing your listings","endpoint":"https://XDQQHFVPXL.gateway.genesis.us-west-2.amazonaws.com/","gatewayId":"XDQQHFVPXL","name":"HelloWorldMCPGatewayBetaTest","protocolType":"MCP","roleArn":"arn:aws:iam::315761230293:role/Admin","status":"READY","updatedAt":"2025-06-12T19:15:37.785928622Z"}
```

### 2. List All Gateways

```bash
awscurl -X GET -H "Content-Type: application/json" https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways --service genesis-test --region us-west-2
```

### 3. Get Specific Gateway

```bash
awscurl -X GET https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways/UTESKHIRMN --service genesis-test --region us-west-2
```
#### Response
```json
{"arn":"arn:aws:genesis:us-west-2:315761230293:gateway/UTESKHIRMN","createdAt":"2025-06-12T19:53:43.612787213Z","description":"One stop shop for managing your listings","endpoint":"https://UTESKHIRMN.gateway.genesis.us-west-2.amazonaws.com/","gatewayId":"UTESKHIRMN","name":"TestLambda001","protocolType":"MCP","roleArn":"arn:aws:iam::315761230293:role/Admin","status":"READY","updatedAt":"2025-06-12T19:53:43.612829358Z"}
```

### 4. Create an OpenAPI Target
```bash
awscurl -X PUT -H "Content-Type: application/json" https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways/UTESKHIRMN/targets --data '{
  "name": "OpenAPITarget",
  "description": "REST API target",
  "targetConfiguration": {
    "mcp": {
      "openApiSchema": {
        "payload": "{\"openapi\":\"3.0.0\",\"info\":{\"title\":\"My API\",\"version\":\"1.0.0\"},\"paths\":{\"/test\":{\"get\":{\"summary\":\"Test endpoint\",\"operationId\":\"testEndpoint\"}}}}"
      }
    }
  }
}' --service genesis-test --region us-west-2
```
#### Response
```json
{"arn":"arn:aws:genesis:us-west-2:315761230293:gateway/UTESKHIRMN","createdAt":"2025-06-12T19:53:43.612787213Z","description":"One stop shop for managing your listings","endpoint":"https://UTESKHIRMN.gateway.genesis.us-west-2.amazonaws.com/","gatewayId":"UTESKHIRMN","name":"TestLambda001","protocolType":"MCP","roleArn":"arn:aws:iam::315761230293:role/Admin","status":"READY","updatedAt":"2025-06-12T19:53:43.612829358Z"}
```

### 5. Create a Lambda Target
Sample Lambda Code in the same region
```python
import json
import logging

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    """
    Genesis Gateway Lambda handler with robust error handling and logging.
    Processes tool requests based on the client context.
    Throws an error if no tool name is provided.
    """
    try:
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Extract tool name from client context
        tool_name = None
        if hasattr(context, 'client_context') and context.client_context is not None:
            logger.info("Processing request from client context")
            tool_name = context.client_context.custom.get('genesisToolName', '')
            logger.info(f"Tool name from client context: {tool_name}")
        
        # Throw error if no tool name is provided
        if not tool_name:
            error_msg = "No tool name provided in request"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # Process based on tool name
        if tool_name == 'get_order_tool':
            logger.info("Processing get_order_tool request")
            return {'statusCode': 200, 'body': "Following are the order details"}
        elif tool_name == 'my_tool':
            logger.info("Processing my_tool request")
            return {'statusCode': 200, 'body': "Called my_tool successfully!"}
        else:
            logger.info(f"Processing default request for tool: {tool_name}")
            return {'statusCode': 200, 'body': "Updated the order details"}
            
    except ValueError as ve:
        logger.error(f"Validation error: {str(ve)}")
        return {
            'statusCode': 400,
            'body': json.dumps({
                'error': 'Bad Request',
                'message': str(ve)
            })
        }
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }
```

```bash
awscurl -X PUT -H "Content-Type: application/json" https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways/UTESKHIRMN/targets --data '{
  "name": "LambdaTarget",
  "description": "Lambda function target",
  "targetConfiguration": {
    "mcp": {
      "lambda": {
        "arn": "arn:aws:lambda:us-west-2:315761230293:function:test_genesis_gateway",
        "toolSchema": {
          "inlinePayload": [
            {
              "name": "my_tool",
              "description": "My custom tool",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "param1": {"type": "string"}
                },
                "required": ["param1"]
              }
            }
          ]
        }
      }
    }
  }
}' --service genesis-test --region us-west-2
```
#### Response
```json
{"createdAt":"2025-06-12T19:48:35.569718466Z","description":"Lambda function target","gatewayIdentifier":"XDQQHFVPXL","name":"LambdaTarget","status":"READY","targetConfiguration":{"mcp":{"lambda":{"arn":"arn:aws:lambda:us-west-2:315761230293:function:test_genesis_gateway","toolSchema":{"inlinePayload":[{"description":"My custom tool","inputSchema":{"properties":{"param1":{"type":"STRING"}},"required":["param1"],"type":"OBJECT"},"name":"my_tool"}]}}}},"targetId":"KWTBTCSQAN","updatedAt":"2025-06-12T19:48:35.569772339Z"}
```

### 6. List Tools (Beta Endpoint)

```bash
./aws_curl.py POST 'https://GATEWAY_ID.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev/gateway/GATEWAY_ID/tools'
```
```bash
awscurl -X POST -H "Content-Type: application/json" 'https://UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev/gateway/UTESKHIRMN/tools' --service genesis-test --region us-west-2
```
#### Response
```json
{"items":[{"description":"My custom tool","name":"my_tool","parameters":{"required":["param1"],"properties":{"param1":{"type":"STRING","exampleSetFlag":false}},"exampleSetFlag":false}}]}
```
### 7. Invoke a Tool (Beta Endpoint)
```bash 
awscurl -X POST -H "Content-Type: application/json" https://UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev/gateway/UTESKHIRMN/tool/invoke --data '{
  "toolName": "my_tool",
  "inputParameters": {
    "param1": "value1"
  }
}' --service genesis-test --region us-west-2
```
#### Response
```json
{"response":"{\"response\":{\"payload\":{\"statusCode\":200,\"body\":\"Called my_tool successfully!\"},\"clientError\":false,\"clientErrorMessage\":null}}"}
```

### 8. Delete a Gateway
```bash
awscurl -X DELETE 'https://lkuac7xqs8.execute-api.us-west-2.amazonaws.com/beta/gateways/XDQQHFVPXL' --service genesis-test --region us-west-2
```

### Use via MCP
```bash
Via MCP
ListTool:

curl -sS -vv --request POST \
--header 'Content-Type: application/json' \
--data '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}' \
'https://UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev/mcp'
InvokeTool:

curl -sS -vv --request POST \
--header 'Content-Type: application/json' \
--data '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
        "name": "listListings",
        "arguments": {
            "exampleSetFlag": "false"
        }
    }
}' \
'https://OYIEYTAQCZ.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev/mcp'

```
#### Response
```bash
* Host UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev:443 was resolved.
* IPv6: (none)
* IPv4: 34.209.30.242, 35.155.218.150, 54.203.140.13
*   Trying 34.209.30.242:443...
* Connected to UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev (34.209.30.242) port 443
* ALPN: curl offers h2,http/1.1
* (304) (OUT), TLS handshake, Client hello (1):
*  CAfile: /etc/ssl/cert.pem
*  CApath: none
* (304) (IN), TLS handshake, Server hello (2):
* TLSv1.2 (IN), TLS handshake, Certificate (11):
* TLSv1.2 (IN), TLS handshake, Server key exchange (12):
* TLSv1.2 (IN), TLS handshake, Server finished (14):
* TLSv1.2 (OUT), TLS handshake, Client key exchange (16):
* TLSv1.2 (OUT), TLS change cipher, Change cipher spec (1):
* TLSv1.2 (OUT), TLS handshake, Finished (20):
* TLSv1.2 (IN), TLS change cipher, Change cipher spec (1):
* TLSv1.2 (IN), TLS handshake, Finished (20):
* SSL connection using TLSv1.2 / ECDHE-RSA-AES128-GCM-SHA256 / [blank] / UNDEF
* ALPN: server accepted h2
* Server certificate:
*  subject: CN=*.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev
*  start date: May 28 00:00:00 2025 GMT
*  expire date: Jun 26 23:59:59 2026 GMT
*  subjectAltName: host "UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev" matched cert's "*.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev"
*  issuer: C=US; O=Amazon; CN=Amazon RSA 2048 M04
*  SSL certificate verify ok.
* using HTTP/2
* [HTTP/2] [1] OPENED stream for https://UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev/mcp
* [HTTP/2] [1] [:method: POST]
* [HTTP/2] [1] [:scheme: https]
* [HTTP/2] [1] [:authority: UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev]
* [HTTP/2] [1] [:path: /mcp]
* [HTTP/2] [1] [user-agent: curl/8.7.1]
* [HTTP/2] [1] [accept: */*]
* [HTTP/2] [1] [content-type: application/json]
* [HTTP/2] [1] [content-length: 75]
> POST /mcp HTTP/2
> Host: UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev
> User-Agent: curl/8.7.1
> Accept: */*
> Content-Type: application/json
> Content-Length: 75
> 
* upload completely sent off: 75 bytes
< HTTP/2 200 
< date: Thu, 12 Jun 2025 20:14:28 GMT
< content-type: application/json
< content-length: 209
< x-amzn-requestid: 5018ad34-3ded-44c9-90b0-4b62725c1d5e
< x-amzn-remapped-content-type: application/json
< 
* Connection #0 to host UTESKHIRMN.genesis-endpoint.beta.us-west-2.shigoe.people.aws.dev left intact
{"jsonrpc":"2.0","id":2.0,"result":{"nextCursor":"","tools":[{"inputSchema":{"type":"object","properties":{"param1":{"type":"STRING"}},"required":["param1"]},"name":"my_tool","description":"My custom tool"}]}}%    
```

## CLI Output

The CLI provides detailed output including:

- **Request Information**: Method, URL, and payload
- **Status Code**: HTTP response status
- **Response Headers**: All response headers
- **Response Body**: The actual API response

Example output:
```
Making PUT request to https://p77s95v8jf.execute-api.us-west-2.amazonaws.com/beta/gateways
With data: {"name": "MyGateway", "protocolType": "MCP", ...}

Status Code: 201
Response Headers: {'Date': 'Thu, 12 Jun 2025 04:49:03 GMT', 'Content-Type': 'application/json', ...}
Response Body: {"arn": "arn:aws:genesis:us-west-2:315761230293:gateway/ABC123", ...}
```

## Error Handling

### Common Errors

1. **Account not allowlisted**:
   ```json
   {"message": "Account is not allowlisted"}
   ```
   **Solution**: Add your account to the Genesis Gateway beta allowlist

2. **Invalid credentials**:
   ```json
   {"message": "The security token included in the request is invalid."}
   ```
   **Solution**: Refresh your AWS credentials

3. **Permission denied**:
   ```json
   {"message": "User: ... is not authorized to perform: genesis-test:..."}
   ```
   **Solution**: Add the required IAM permissions

## Tips

1. **Save Gateway ID**: After creating a gateway, save the `gatewayId` from the response for future operations
2. **Use Beta Endpoints**: For tool operations, use the beta endpoint format with your gateway ID
3. **JSON Formatting**: Ensure JSON payloads are properly formatted and escaped
4. **Role ARN**: Make sure the role ARN you specify has the necessary permissions for your use case

## Environment Variables

The cli automatically uses your AWS credentials from:
- Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
- AWS credentials file (`~/.aws/credentials`)
- IAM roles (if running on EC2)
- AWS SSO

## Troubleshooting

If you encounter issues:

1. **Verify AWS credentials**: `aws sts get-caller-identity`
2. **Check account allowlist status**: Contact the Genesis Gateway team
3. **Validate JSON**: Use a JSON validator for complex payloads
4. **Check permissions**: Ensure your IAM role has the required permissions
