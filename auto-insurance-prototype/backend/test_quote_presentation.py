#!/usr/bin/env python3
"""
Test script to verify that the chat endpoint properly presents generated quotes
"""

import requests
import json
import time

def test_quote_presentation():
    """Test that quotes are properly presented by the LLM"""
    
    # Test data with complete vehicle information
    chat_request = {
        "customer_id": "CUST001",
        "messages": [
            {
                "role": "user",
                "content": "Hi, I need a quote for my 2018 Toyota Camry"
            }
        ]
    }
    
    try:
        print("Testing quote presentation...")
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
            print(f"\n✅ SUCCESS - Chat endpoint responded")
            
            # Check if quote was generated
            if result.get('quote'):
                print(f"✅ Quote generated: {result['quote']['quote_id']}")
                print(f"✅ Premium: ${result['quote']['premium']['amount']:,.2f}")
                
                # Check if the response includes quote details
                response_text = result['response'].lower()
                
                # Look for key quote elements in the response
                checks = {
                    'quote_id': result['quote']['quote_id'].lower() in response_text,
                    'premium_amount': f"${result['quote']['premium']['amount']:,.2f}".lower() in response_text or str(int(result['quote']['premium']['amount'])) in response_text,
                    'vehicle_info': f"{result['quote']['vehicle']['year']}" in response_text and result['quote']['vehicle']['make'].lower() in response_text,
                    'coverage_type': result['quote']['coverage']['product']['name'].lower() in response_text,
                    'risk_level': result['quote']['risk_factors']['overall_risk'].lower() in response_text
                }
                
                print(f"\nQuote Presentation Checks:")
                for check, passed in checks.items():
                    status = "✅" if passed else "❌"
                    print(f"{status} {check}: {passed}")
                
                # Print the full response for manual review
                print(f"\nFull LLM Response:")
                print("-" * 50)
                print(result['response'])
                print("-" * 50)
                
                # Overall assessment
                passed_checks = sum(checks.values())
                total_checks = len(checks)
                
                if passed_checks >= 3:  # At least 3 out of 5 key elements
                    print(f"\n✅ QUOTE PRESENTATION: GOOD ({passed_checks}/{total_checks} elements found)")
                    return True
                else:
                    print(f"\n❌ QUOTE PRESENTATION: POOR ({passed_checks}/{total_checks} elements found)")
                    print("The LLM is not presenting the quote details properly")
                    return False
                    
            else:
                print("❌ No quote was generated")
                print(f"Response: {result['response']}")
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
    print("=" * 60)
    print("TESTING QUOTE PRESENTATION IN CHAT")
    print("=" * 60)
    print("This test verifies that when a quote is generated,")
    print("the LLM properly presents all quote details to the user")
    print()
    
    success = test_quote_presentation()
    
    print("\n" + "=" * 60)
    if success:
        print("✅ TEST PASSED - Quote presentation is working correctly")
    else:
        print("❌ TEST FAILED - Quote presentation needs improvement")
        print("\nThe LLM should present:")
        print("- Quote ID")
        print("- Premium amount")
        print("- Vehicle information")
        print("- Coverage details")
        print("- Risk assessment")

if __name__ == "__main__":
    main()
