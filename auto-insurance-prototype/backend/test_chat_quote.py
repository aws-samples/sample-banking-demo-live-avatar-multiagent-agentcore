#!/usr/bin/env python3
"""
Test chat endpoint with quote generation
"""

import requests
import json

def test_chat_with_quote():
    """Test chat endpoint with complete vehicle info to trigger quote generation"""
    
    print("🧪 Testing Chat with Quote Generation")
    print("=" * 50)
    
    # Test message that should trigger quote generation
    test_request = {
        "customer_id": "cust-001",
        "messages": [
            {"role": "user", "content": "I need a quote for my 2024 Toyota Camry"}
        ]
    }
    
    try:
        print("📤 Sending chat request with complete vehicle info...")
        print(f"Message: '{test_request['messages'][0]['content']}'")
        
        response = requests.post(
            "http://localhost:8000/chat",
            json=test_request,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"📊 Status code: {response.status_code}")
        
        if response.status_code == 200:
            chat_data = response.json()
            print("✅ Chat response received!")
            
            # Check if vehicle info was extracted
            if chat_data.get('extracted_info'):
                print(f"🚗 Extracted vehicle info: {chat_data['extracted_info']}")
            
            # Check if quote was generated
            if chat_data.get('quote'):
                quote = chat_data['quote']
                print("🎉 Quote generated successfully!")
                print(f"📋 Quote ID: {quote['quote_id']}")
                print(f"💰 Premium: ${quote['premium']['amount']:,.2f}")
                print(f"🚗 Vehicle: {quote['vehicle']['year']} {quote['vehicle']['make']} {quote['vehicle']['model']}")
            else:
                print("ℹ️  No quote generated (may need more info)")
            
            # Check agent traces
            if chat_data.get('agent_traces'):
                print(f"🔍 Agent traces: {len(chat_data['agent_traces'])} traces")
            
            # Show response preview
            response_preview = chat_data['response'][:200] + "..." if len(chat_data['response']) > 200 else chat_data['response']
            print(f"🤖 Response preview: {response_preview}")
            
            return True
        else:
            print(f"❌ Chat request failed: {response.status_code}")
            print(f"Error: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        return False

if __name__ == "__main__":
    test_chat_with_quote()
