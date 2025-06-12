#!/usr/bin/env python3
"""
Test script to reproduce the exact error from the chat transcript
"""

import requests
import json

def test_ford_ranger_2020():
    """Test the exact conversation that's failing"""
    
    # Reproduce the exact conversation from the transcript
    chat_request = {
        "customer_id": "cust-001",  # Use correct customer ID format
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "Hi there! I'm happy to help you get an auto insurance quote. To get started, I'll need some information about your vehicle. Could you please provide me with the make, model, and year of the vehicle you'd like to insure? The year should be between 2018-2025."},
            {"role": "user", "content": "ford ranger 2020"}
        ]
    }
    
    try:
        print("Testing the exact conversation that's failing...")
        print(f"Request: {json.dumps(chat_request, indent=2)}")
        
        # Make request to chat endpoint
        response = requests.post(
            "http://localhost:8000/chat",
            json=chat_request,
            timeout=30
        )
        
        print(f"\nResponse Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ SUCCESS - Chat worked!")
            print(f"Response: {result['response'][:200]}...")
            
            if result.get('quote'):
                print(f"✅ Quote generated: {result['quote']['quote_id']}")
                print(f"Premium: ${result['quote']['premium']:,.2f}")
                print(f"Vehicle: {result['quote']['vehicle_info']}")
            else:
                print("❌ No quote generated")
                print(f"Extracted info: {result.get('extracted_info')}")
                if result.get('agent_traces'):
                    print(f"Agent traces: {len(result['agent_traces'])} traces")
                
        elif response.status_code == 500:
            print(f"❌ 500 INTERNAL SERVER ERROR - This matches the user's issue")
            try:
                error_detail = response.json().get('detail', 'Unknown error')
                print(f"Error details: {error_detail}")
            except:
                print(f"Raw error response: {response.text}")
                
        else:
            print(f"❌ Unexpected status: {response.status_code}")
            try:
                error_detail = response.json().get('detail', 'Unknown error')
                print(f"Error: {error_detail}")
            except:
                print(f"Raw response: {response.text}")
            
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    test_ford_ranger_2020()
