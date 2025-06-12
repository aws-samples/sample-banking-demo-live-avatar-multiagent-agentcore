#!/usr/bin/env python3
"""
Debug script to test quote generation directly
"""

from agent_system import process_quote_request

def test_quote_generation():
    """Test quote generation directly"""
    
    # Test vehicle info that should work
    vehicle_info = {
        "make": "Ford",
        "model": "Ranger", 
        "year": 2022
    }
    
    customer_id = "cust-001"
    
    print("Testing quote generation directly...")
    print(f"Customer ID: {customer_id}")
    print(f"Vehicle Info: {vehicle_info}")
    
    try:
        result = process_quote_request(customer_id, vehicle_info)
        
        print(f"\nResult type: {type(result)}")
        print(f"Result keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
        
        if "error" in result:
            print(f"❌ ERROR: {result['error']}")
            return False
        elif "final_quote" in result:
            quote = result["final_quote"]
            print(f"✅ SUCCESS: Quote generated")
            print(f"Quote ID: {quote.get('quote_id', 'Missing')}")
            print(f"Premium: ${quote.get('premium', {}).get('amount', 'Missing'):,.2f}")
            return True
        else:
            print(f"❌ UNEXPECTED RESULT: {result}")
            return False
            
    except Exception as e:
        print(f"❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    test_quote_generation()
