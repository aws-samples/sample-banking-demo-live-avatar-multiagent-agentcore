#!/usr/bin/env python3
"""
Test script for the enhanced auto insurance quote system
"""

import sys
import os
import logging
from datetime import datetime

# Add the backend directory to the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("test_enhanced_system")

def test_data_access():
    """Test the data access layer"""
    logger.info("Testing data access layer...")
    
    try:
        from data_access import data_access
        
        # Test health check
        health = data_access.health_check()
        logger.info(f"Data access health: {health}")
        
        # Test customer info retrieval
        customer_info = data_access.get_customer_info("cust-001")
        logger.info(f"Customer info retrieved: {customer_info.get('name', 'Unknown')}")
        
        # Test vehicle info retrieval
        vehicle_info = data_access.get_vehicle_info("Toyota", "Camry", 2024)
        logger.info(f"Vehicle info retrieved: {vehicle_info.get('make', 'Unknown')} {vehicle_info.get('model', 'Unknown')}")
        
        # Test insurance products
        products = data_access.get_insurance_products()
        logger.info(f"Retrieved {len(products)} insurance products")
        
        logger.info("Data access layer test completed successfully!")
        return True
        
    except Exception as e:
        logger.error(f"Data access layer test failed: {str(e)}")
        return False

def test_enhanced_agents():
    """Test the enhanced agent system"""
    logger.info("Testing enhanced agent system...")
    
    try:
        from agent_system_enhanced import process_quote_request, get_system_health
        
        # Test system health
        health = get_system_health()
        logger.info(f"System health: {health['status']}")
        
        # Test quote processing
        test_customer_id = "cust-001"
        test_vehicle = {
            "make": "Toyota",
            "model": "Camry", 
            "year": 2024
        }
        
        logger.info(f"Processing quote for customer {test_customer_id}")
        result = process_quote_request(test_customer_id, test_vehicle)
        
        if "error" in result:
            logger.error(f"Quote processing failed: {result['error']}")
            return False
        else:
            quote = result["final_quote"]
            metadata = result["processing_metadata"]
            
            logger.info(f"Quote generated successfully!")
            logger.info(f"Quote ID: {quote['quote_id']}")
            logger.info(f"Customer: {quote['customer']['name']}")
            logger.info(f"Vehicle: {quote['vehicle']['year']} {quote['vehicle']['make']} {quote['vehicle']['model']}")
            logger.info(f"Premium: ${quote['premium']['amount']:,.2f}")
            logger.info(f"Total processing time: {metadata.get('total_processing_time', 'Unknown'):.2f}s")
            
            return True
            
    except Exception as e:
        logger.error(f"Enhanced agent system test failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def main():
    """Run all tests"""
    logger.info("Starting enhanced system tests...")
    start_time = datetime.now()
    
    tests = [
        ("Data Access Layer", test_data_access),
        ("Enhanced Agent System", test_enhanced_agents)
    ]
    
    results = {}
    for test_name, test_func in tests:
        logger.info(f"\n{'='*50}")
        logger.info(f"Running test: {test_name}")
        logger.info(f"{'='*50}")
        
        try:
            results[test_name] = test_func()
        except Exception as e:
            logger.error(f"Test {test_name} crashed: {str(e)}")
            results[test_name] = False
    
    # Summary
    total_time = (datetime.now() - start_time).total_seconds()
    logger.info(f"\n{'='*50}")
    logger.info("TEST SUMMARY")
    logger.info(f"{'='*50}")
    
    passed = sum(1 for result in results.values() if result)
    total = len(results)
    
    for test_name, result in results.items():
        status = "PASSED" if result else "FAILED"
        logger.info(f"{test_name}: {status}")
    
    logger.info(f"\nOverall: {passed}/{total} tests passed")
    logger.info(f"Total execution time: {total_time:.2f}s")
    
    if passed == total:
        logger.info("All tests passed! ✅")
        return 0
    else:
        logger.error("Some tests failed! ❌")
        return 1

if __name__ == "__main__":
    sys.exit(main())
