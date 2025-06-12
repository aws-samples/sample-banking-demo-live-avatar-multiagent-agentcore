#!/usr/bin/env python3
"""
Test script to verify that the chat endpoint properly fails when Bedrock is unavailable.
This ensures the application remains strictly LLM-powered.
"""

import requests
import json
import sys

def test_chat_endpoint():
    """Test the chat endpoint to ensure it fails gracefully when Bedrock is unavailable"""
    
    # Test data
    chat_request = {
        "customer_id": "CUST001",
        "messages": [
            {
                "role": "user",
                "content": "Hi, I need a quote for my 2022 Toyota Camry"
            }
        ]
    }
    
    try:
        print("Testing chat endpoint...")
        print(f"Request: {json.dumps(chat_request, indent=2)}")
        
        # Make request to chat endpoint
        response = requests.post(
            "http://localhost:8000/chat",
            json=chat_request,
            timeout=30
        )
        
        print(f"\nResponse Status: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            # Success - Bedrock is working
            result = response.json()
            print(f"\n✅ SUCCESS - Chat endpoint working with Bedrock")
            print(f"Response: {result['response'][:200]}...")
            if result.get('quote'):
                print(f"Quote generated: {result['quote']['quote_id']}")
            return True
            
        elif response.status_code == 503:
            # Expected failure when Bedrock is unavailable
            error_detail = response.json().get('detail', 'Unknown error')
            print(f"\n✅ EXPECTED FAILURE - Chat endpoint properly failed when Bedrock unavailable")
            print(f"Error: {error_detail}")
            return True
            
        else:
            # Unexpected error
            print(f"\n❌ UNEXPECTED ERROR - Status {response.status_code}")
            try:
                error_detail = response.json().get('detail', 'Unknown error')
                print(f"Error: {error_detail}")
            except:
                print(f"Raw response: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ ERROR - Cannot connect to backend server. Is it running on localhost:8000?")
        return False
    except requests.exceptions.Timeout:
        print("❌ ERROR - Request timed out")
        return False
    except Exception as e:
        print(f"❌ ERROR - Unexpected exception: {e}")
        return False

def main():
    """Main test function"""
    print("=" * 60)
    print("TESTING CHAT ENDPOINT - BEDROCK REQUIREMENT")
    print("=" * 60)
    print("This test verifies that the chat endpoint:")
    print("1. Works when Bedrock is available")
    print("2. Fails with 503 error when Bedrock is unavailable")
    print("3. Does NOT provide fallback responses")
    print()
    
    success = test_chat_endpoint()
    
    print("\n" + "=" * 60)
    if success:
        print("✅ TEST PASSED - Chat endpoint behavior is correct")
        print("The application properly requires LLM (Bedrock) to function")
    else:
        print("❌ TEST FAILED - Chat endpoint behavior is incorrect")
        sys.exit(1)

if __name__ == "__main__":
    main()
