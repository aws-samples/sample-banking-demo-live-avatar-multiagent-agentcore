#!/usr/bin/env python3
"""
Test script to verify that multi-turn conversations properly generate quotes
"""

import requests
import json

def test_multiturn_conversation():
    """Test that quotes are generated from multi-turn conversations"""
    
    # Simulate the conversation from the user's transcript
    chat_request = {
        "customer_id": "CUST001",
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "Hi there! I'd be happy to get you an auto insurance quote. To start, can you please provide me with the make, model, and year of your vehicle?"},
            {"role": "user", "content": "ford"},
            {"role": "assistant", "content": "Okay, great. The make is Ford. What is the specific model of your Ford vehicle?"},
            {"role": "user", "content": "ranger"},
            {"role": "assistant", "content": "Got it, a Ford Ranger. And what is the year of your Ford Ranger?"},
            {"role": "user", "content": "2022"}
        ]
    }
    
    try:
        print("Testing multi-turn conversation quote generation...")
        print("Conversation history:")
        for i, msg in enumerate(chat_request["messages"]):
            print(f"  {i+1}. {msg['role']}: {msg['content']}")
        
        # Make request to chat endpoint
        response = requests.post(
            "http://localhost:8000/chat",
            json=chat_request,
            timeout=30
        )
        
        print(f"\nResponse Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"\n✅ SUCCESS - Chat endpoint responded")
            
            # Check extracted information
            if result.get('extracted_info'):
                extracted = result['extracted_info']
                print(f"\nExtracted Information:")
                print(f"  Make: {extracted.get('make', 'NOT FOUND')}")
                print(f"  Model: {extracted.get('model', 'NOT FOUND')}")
                print(f"  Year: {extracted.get('year', 'NOT FOUND')}")
                
                # Check if all required info was extracted
                has_all_info = all(key in extracted for key in ['make', 'model', 'year'])
                print(f"  Complete Info: {'✅ YES' if has_all_info else '❌ NO'}")
                
                if has_all_info:
                    expected_make = "Ford"
                    expected_model = "Ranger"
                    expected_year = 2022
                    
                    correct_extraction = (
                        extracted.get('make') == expected_make and
                        extracted.get('model') == expected_model and
                        extracted.get('year') == expected_year
                    )
                    
                    if correct_extraction:
                        print("✅ Vehicle information extracted correctly!")
                    else:
                        print("❌ Vehicle information extraction incorrect")
                        print(f"   Expected: {expected_year} {expected_make} {expected_model}")
                        print(f"   Got: {extracted.get('year')} {extracted.get('make')} {extracted.get('model')}")
                
            else:
                print("❌ No extracted information found")
            
            # Check if quote was generated
            if result.get('quote'):
                quote = result['quote']
                print(f"\n✅ QUOTE GENERATED!")
                print(f"  Quote ID: {quote['quote_id']}")
                print(f"  Vehicle: {quote['vehicle']['year']} {quote['vehicle']['make']} {quote['vehicle']['model']}")
                print(f"  Premium: ${quote['premium']['amount']:,.2f}")
                
                # Check if response includes quote details
                response_text = result['response']
                print(f"\nLLM Response Preview:")
                print(f"  Length: {len(response_text)} characters")
                print(f"  Contains Quote ID: {'✅' if quote['quote_id'] in response_text else '❌'}")
                print(f"  Contains Premium: {'✅' if str(int(quote['premium']['amount'])) in response_text else '❌'}")
                
                return True
                
            else:
                print("❌ NO QUOTE GENERATED")
                print(f"LLM Response: {result['response']}")
                return False
                
        else:
            print(f"❌ ERROR - Status {response.status_code}")
            try:
                error_detail = response.json().get('detail', 'Unknown error')
                print(f"Error: {error_detail}")
            except:
                print(f"Raw response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ ERROR - Exception: {e}")
        return False

def main():
    """Main test function"""
    print("=" * 70)
    print("TESTING MULTI-TURN CONVERSATION QUOTE GENERATION")
    print("=" * 70)
    print("This test simulates the exact conversation from the user's transcript")
    print("and verifies that vehicle info is extracted from multiple messages")
    print()
    
    success = test_multiturn_conversation()
    
    print("\n" + "=" * 70)
    if success:
        print("✅ TEST PASSED - Multi-turn conversation works correctly")
    else:
        print("❌ TEST FAILED - Multi-turn conversation needs fixing")

if __name__ == "__main__":
    main()
