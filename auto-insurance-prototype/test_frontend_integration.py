#!/usr/bin/env python3
"""
Test script to verify frontend integration with enhanced backend
"""

import requests
import json
import time

def test_enhanced_api():
    """Test the enhanced API endpoint that the frontend will use"""
    
    print("🧪 Testing Enhanced Frontend Integration")
    print("=" * 50)
    
    # Test data that matches what the frontend sends
    test_request = {
        "customer_id": "cust-001",
        "vehicle_info": {
            "make": "Toyota",
            "model": "Camry", 
            "year": 2024
        },
        "coverage_type": "standard"
    }
    
    try:
        print("📤 Sending request to /api/quotes...")
        print(f"Request data: {json.dumps(test_request, indent=2)}")
        
        start_time = time.time()
        response = requests.post(
            "http://localhost:8000/api/quotes",
            json=test_request,
            headers={"Content-Type": "application/json"}
        )
        end_time = time.time()
        
        print(f"⏱️  Response time: {(end_time - start_time)*1000:.0f}ms")
        print(f"📊 Status code: {response.status_code}")
        
        if response.status_code == 200:
            quote_data = response.json()
            print("✅ Quote generated successfully!")
            print(f"📋 Quote ID: {quote_data['quote_id']}")
            print(f"🚗 Vehicle: {quote_data['vehicle']['year']} {quote_data['vehicle']['make']} {quote_data['vehicle']['model']}")
            print(f"💰 Premium: ${quote_data['premium']['amount']:,.2f}")
            print(f"⚠️  Risk Level: {quote_data['risk_factors']['overall_risk'].title()}")
            
            if 'processing_metadata' in quote_data:
                metadata = quote_data['processing_metadata']
                print(f"⚡ Total Processing Time: {metadata.get('total_processing_time', 0)*1000:.0f}ms")
                
            return True
        else:
            print(f"❌ Request failed: {response.status_code}")
            print(f"Error: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - make sure the backend is running:")
        print("   cd backend && python app.py")
        return False
    except Exception as e:
        print(f"❌ Test failed: {str(e)}")
        return False

def test_chat_api():
    """Test the chat API endpoint"""
    
    print("\n🗣️  Testing Chat API Integration")
    print("=" * 50)
    
    chat_request = {
        "customer_id": "cust-001",
        "messages": [
            {"role": "user", "content": "I need a quote for my 2024 Toyota Camry"}
        ]
    }
    
    try:
        print("📤 Sending chat request...")
        
        start_time = time.time()
        response = requests.post(
            "http://localhost:8000/chat",
            json=chat_request,
            headers={"Content-Type": "application/json"}
        )
        end_time = time.time()
        
        print(f"⏱️  Response time: {(end_time - start_time)*1000:.0f}ms")
        print(f"📊 Status code: {response.status_code}")
        
        if response.status_code == 200:
            chat_data = response.json()
            print("✅ Chat response received!")
            print(f"🤖 Response: {chat_data['response'][:100]}...")
            
            if chat_data.get('quote'):
                print(f"📋 Quote generated in chat: {chat_data['quote']['quote_id']}")
                
            if chat_data.get('agent_traces'):
                print(f"🔍 Agent traces: {len(chat_data['agent_traces'])} traces")
                
            return True
        else:
            print(f"❌ Chat request failed: {response.status_code}")
            print(f"Error: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Chat test failed: {str(e)}")
        return False

def test_system_health():
    """Test system health endpoint"""
    
    print("\n🏥 Testing System Health")
    print("=" * 50)
    
    try:
        response = requests.get("http://localhost:8000/api/system/health")
        
        if response.status_code == 200:
            health_data = response.json()
            print("✅ System health check passed!")
            print(f"📊 Status: {health_data.get('status', 'unknown')}")
            print(f"🔗 MCP Healthy: {health_data.get('data_access', {}).get('mcp_healthy', False)}")
            print(f"💾 Local Data: {health_data.get('data_access', {}).get('local_data_loaded', False)}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Health check failed: {str(e)}")
        return False

def main():
    """Run all integration tests"""
    
    print("🚀 Frontend Integration Test Suite")
    print("Testing enhanced backend endpoints that the frontend uses")
    print()
    
    tests = [
        ("Enhanced Quote API", test_enhanced_api),
        ("Chat API", test_chat_api), 
        ("System Health", test_system_health)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} crashed: {str(e)}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 TEST SUMMARY")
    print("=" * 50)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{test_name}: {status}")
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All integration tests passed!")
        print("The frontend should work perfectly with the enhanced backend!")
        print("\nTo start the system:")
        print("1. Backend: cd backend && python app.py")
        print("2. Frontend: cd frontend && npm start")
    else:
        print("\n⚠️  Some tests failed. Check the backend setup.")
        
    return 0 if passed == total else 1

if __name__ == "__main__":
    exit(main())
