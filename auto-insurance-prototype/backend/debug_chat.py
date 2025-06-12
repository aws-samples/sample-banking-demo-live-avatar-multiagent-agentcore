#!/usr/bin/env python3
"""
Debug script to identify chat endpoint issues
"""

import json
import boto3
import os
from dotenv import load_dotenv

load_dotenv()

def test_bedrock_connection():
    """Test AWS Bedrock connection"""
    try:
        aws_region = os.getenv("AWS_REGION", "us-west-2")
        print(f"Testing Bedrock connection in region: {aws_region}")
        
        bedrock_client = boto3.client(service_name="bedrock-runtime", region_name=aws_region)
        
        # Simple test call
        response = bedrock_client.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 100,
                "messages": [{"role": "user", "content": "Hello"}],
                "temperature": 0.7,
            }),
        )
        
        response_body = json.loads(response.get("body").read())
        print("✅ Bedrock connection successful!")
        print(f"Response: {response_body.get('content')[0].get('text')[:50]}...")
        return True
        
    except Exception as e:
        print(f"❌ Bedrock connection failed: {str(e)}")
        return False

def test_chat_endpoint():
    """Test the chat endpoint directly"""
    try:
        import requests
        
        test_request = {
            "customer_id": "cust-001",
            "messages": [
                {"role": "user", "content": "Hello, I need help with insurance"}
            ]
        }
        
        print("Testing chat endpoint...")
        response = requests.post(
            "http://localhost:8000/chat",
            json=test_request,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print("✅ Chat endpoint working!")
            print(f"Response: {data.get('response', 'No response')[:100]}...")
        else:
            print(f"❌ Chat endpoint failed: {response.text}")
            
    except Exception as e:
        print(f"❌ Chat endpoint test failed: {str(e)}")

if __name__ == "__main__":
    print("🔍 Debugging Chat Issues")
    print("=" * 40)
    
    print("\n1. Testing Bedrock Connection:")
    bedrock_ok = test_bedrock_connection()
    
    print("\n2. Testing Chat Endpoint:")
    test_chat_endpoint()
    
    if not bedrock_ok:
        print("\n💡 Possible solutions:")
        print("1. Check AWS credentials: aws configure")
        print("2. Verify Bedrock access in your AWS account")
        print("3. Check AWS_REGION environment variable")
        print("4. Ensure you have Bedrock permissions")
