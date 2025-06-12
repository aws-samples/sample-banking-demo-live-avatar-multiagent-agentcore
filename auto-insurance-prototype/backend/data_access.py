"""
Data Access Layer with MCP Integration and Fallback Mechanisms

This module provides a unified interface for accessing data from both MCP servers
and local JSON files, with automatic fallback and comprehensive logging.
"""

import json
import os
import logging
from typing import Dict, Any, List, Optional, Union
from functools import wraps
from mcp_client import MCPClient
from tracing import trace_data_access

logger = logging.getLogger("backend.data_access")

# Configuration
class DataAccessConfig:
    MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8001")
    USE_MCP_SERVER = os.getenv("USE_MCP_SERVER", "true").lower() == "true"
    FALLBACK_ENABLED = os.getenv("ENABLE_FALLBACK", "true").lower() == "true"
    MCP_TIMEOUT = int(os.getenv("MCP_TIMEOUT", "30"))

# Load local data files
data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

def load_local_data():
    """Load all local JSON data files"""
    try:
        with open(os.path.join(data_dir, "customers.json"), "r") as f:
            customers = json.load(f)
        
        with open(os.path.join(data_dir, "vehicles.json"), "r") as f:
            vehicles = json.load(f)
        
        with open(os.path.join(data_dir, "credit_reports.json"), "r") as f:
            credit_reports = json.load(f)
        
        with open(os.path.join(data_dir, "products.json"), "r") as f:
            products = json.load(f)
        
        with open(os.path.join(data_dir, "pricing_rules.json"), "r") as f:
            pricing_rules = json.load(f)
        
        with open(os.path.join(data_dir, "policies.json"), "r") as f:
            policies = json.load(f)
        
        logger.info("Successfully loaded all local data files")
        return {
            "customers": customers,
            "vehicles": vehicles,
            "credit_reports": credit_reports,
            "products": products,
            "pricing_rules": pricing_rules,
            "policies": policies
        }
    except Exception as e:
        logger.error(f"Failed to load local data files: {str(e)}")
        raise

# Global data cache
LOCAL_DATA = load_local_data()

def with_fallback(operation_name: str):
    """Decorator to add fallback functionality to data access methods"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            mcp_success = False
            fallback_used = False
            error_details = None
            
            # Remove use_mcp from kwargs if present to avoid conflicts
            use_mcp_override = kwargs.pop('use_mcp', None)
            
            try:
                if DataAccessConfig.USE_MCP_SERVER:
                    logger.debug(f"Attempting MCP server access for {operation_name}")
                    result = func(*args, use_mcp=True, **kwargs)
                    mcp_success = True
                    trace_data_access(operation_name, {"source": "mcp", "success": True}, result)
                    logger.info(f"Successfully retrieved {operation_name} from MCP server")
                    return result
                else:
                    logger.debug(f"MCP server disabled, using local data for {operation_name}")
                    raise ValueError("MCP server disabled in configuration")
                    
            except Exception as e:
                error_details = str(e)
                logger.warning(f"MCP server access failed for {operation_name}: {error_details}")
                
                if DataAccessConfig.FALLBACK_ENABLED:
                    try:
                        logger.info(f"Attempting fallback to local data for {operation_name}")
                        result = func(*args, use_mcp=False, **kwargs)
                        fallback_used = True
                        trace_data_access(operation_name, {
                            "source": "local_fallback", 
                            "mcp_error": error_details,
                            "success": True
                        }, result)
                        logger.info(f"Successfully retrieved {operation_name} from local fallback")
                        return result
                    except Exception as fallback_error:
                        logger.error(f"Fallback also failed for {operation_name}: {str(fallback_error)}")
                        trace_data_access(operation_name, {
                            "source": "failed",
                            "mcp_error": error_details,
                            "fallback_error": str(fallback_error),
                            "success": False
                        }, None)
                        raise ValueError(f"Both MCP and fallback failed for {operation_name}: MCP={error_details}, Fallback={str(fallback_error)}")
                else:
                    logger.error(f"Fallback disabled, failing {operation_name}")
                    trace_data_access(operation_name, {
                        "source": "failed",
                        "mcp_error": error_details,
                        "fallback_disabled": True,
                        "success": False
                    }, None)
                    raise ValueError(f"MCP server failed and fallback disabled for {operation_name}: {error_details}")
        
        return wrapper
    return decorator


class EnhancedDataAccess:
    """Enhanced data access layer with MCP integration and fallback"""
    
    def __init__(self):
        self.mcp_client = None
        if DataAccessConfig.USE_MCP_SERVER:
            try:
                self.mcp_client = MCPClient(
                    base_url=DataAccessConfig.MCP_SERVER_URL,
                    timeout=DataAccessConfig.MCP_TIMEOUT
                )
                logger.info("MCP client initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize MCP client: {str(e)}")
                if not DataAccessConfig.FALLBACK_ENABLED:
                    raise
    
    @with_fallback("customer_info")
    def get_customer_info(self, customer_id: str, use_mcp: bool = True) -> Dict[str, Any]:
        """Get customer information with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_customer_info(customer_id)
        else:
            # Local fallback
            customers = LOCAL_DATA["customers"]["customers"]
            customer = next((c for c in customers if c["id"] == customer_id), None)
            if not customer:
                raise ValueError(f"Customer {customer_id} not found in local data")
            return customer
    
    @with_fallback("customer_credit")
    def get_customer_credit(self, customer_id: str, use_mcp: bool = True) -> Dict[str, Any]:
        """Get customer credit information with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_customer_credit(customer_id)
        else:
            # Local fallback
            credit_reports = LOCAL_DATA["credit_reports"]["credit_reports"]
            credit = next((c for c in credit_reports if c["customer_id"] == customer_id), None)
            if not credit:
                raise ValueError(f"Credit report for customer {customer_id} not found in local data")
            return credit
    
    @with_fallback("vehicle_info")
    def get_vehicle_info(self, make: str, model: str, year: int, use_mcp: bool = True) -> Dict[str, Any]:
        """Get vehicle information with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_vehicle_info(make, model, year)
        else:
            # Local fallback
            vehicles = LOCAL_DATA["vehicles"]["vehicles"]
            vehicle = next((v for v in vehicles 
                          if v["make"].lower() == make.lower() 
                          and v["model"].lower() == model.lower() 
                          and v["year"] == year), None)
            if not vehicle:
                # Return a generic vehicle if specific one not found
                logger.warning(f"Specific vehicle {make} {model} {year} not found, using generic data")
                return {
                    "make": make,
                    "model": model,
                    "year": year,
                    "value": 25000,  # Default value
                    "safety_rating": 4,
                    "theft_rating": "moderate"
                }
            return vehicle
    
    @with_fallback("vehicle_safety")
    def get_vehicle_safety_rating(self, make: str, model: str, year: Optional[int] = None, use_mcp: bool = True) -> Dict[str, Any]:
        """Get vehicle safety rating with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_vehicle_safety_rating(make, model, year)
        else:
            # Local fallback - extract from vehicle data
            vehicles = LOCAL_DATA["vehicles"]["vehicles"]
            vehicle = next((v for v in vehicles 
                          if v["make"].lower() == make.lower() 
                          and v["model"].lower() == model.lower()), None)
            if vehicle:
                return {
                    "safety_rating": vehicle.get("safety_rating", 4),
                    "safety_features": vehicle.get("safety_features", [])
                }
            else:
                return {"safety_rating": 4, "safety_features": []}
    
    @with_fallback("insurance_products")
    def get_insurance_products(self, state: Optional[str] = None, use_mcp: bool = True) -> List[Dict[str, Any]]:
        """Get insurance products with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_insurance_products(state)
        else:
            # Local fallback
            return LOCAL_DATA["products"]["products"]
    
    @with_fallback("pricing_rules")
    def get_pricing_rules(self, state: Optional[str] = None, use_mcp: bool = True) -> Dict[str, Any]:
        """Get pricing rules with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_pricing_rules(state)
        else:
            # Local fallback
            return LOCAL_DATA["pricing_rules"]
    
    @with_fallback("customer_policies")
    def get_customer_policies(self, customer_id: str, use_mcp: bool = True) -> List[Dict[str, Any]]:
        """Get customer policies with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_customer_policies(customer_id)
        else:
            # Local fallback
            policies = LOCAL_DATA["policies"]["policies"]
            customer_policies = [p for p in policies if p["customer_id"] == customer_id]
            return customer_policies
    
    @with_fallback("risk_factors")
    def get_risk_factors(self, customer_id: str, vehicle_info: Dict[str, Any], use_mcp: bool = True) -> Dict[str, Any]:
        """Get risk factors with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.get_risk_factors(customer_id, vehicle_info)
        else:
            # Local fallback - basic risk calculation
            customer_info = self.get_customer_info(customer_id, use_mcp=False)
            pricing_rules = self.get_pricing_rules(use_mcp=False)
            
            # Calculate age from date of birth
            from datetime import datetime
            if "dob" in customer_info:
                dob = datetime.strptime(customer_info["dob"], "%Y-%m-%d")
                age = (datetime.now() - dob).days // 365
            else:
                age = customer_info.get("age", 35)  # Default age if not available
            
            driving_history = customer_info.get("driving_history", {})
            
            # Calculate basic risk factors
            age_factor = 1.0
            if age < 25:
                age_factor = 1.4
            elif age > 60:
                age_factor = 1.1
            
            history_factor = 1.0
            accidents = len(driving_history.get("accidents", []))
            violations = len(driving_history.get("violations", []))
            
            if accidents > 0:
                history_factor += 0.2 * accidents
            if violations > 0:
                history_factor += 0.1 * violations
            
            return {
                "age_factor": age_factor,
                "history_factor": history_factor,
                "vehicle_factor": 1.0,
                "overall_risk": "moderate" if history_factor > 1.2 else "low",
                "age": age,
                "accidents": accidents,
                "violations": violations
            }
    
    @with_fallback("save_quote")
    def save_quote(self, quote_data: Dict[str, Any], use_mcp: bool = True) -> Dict[str, Any]:
        """Save quote with MCP/fallback support"""
        if use_mcp and self.mcp_client:
            return self.mcp_client.save_quote(quote_data)
        else:
            # Local fallback - just log the quote
            quote_id = f"LOCAL_{quote_data.get('customer_id', 'UNKNOWN')}_{len(str(quote_data))}"
            logger.info(f"Quote saved locally with ID: {quote_id}")
            return {"quote_id": quote_id}
    
    def health_check(self) -> Dict[str, Any]:
        """Check health of data access systems"""
        health_status = {
            "mcp_enabled": DataAccessConfig.USE_MCP_SERVER,
            "fallback_enabled": DataAccessConfig.FALLBACK_ENABLED,
            "local_data_loaded": bool(LOCAL_DATA),
            "mcp_healthy": False
        }
        
        if self.mcp_client:
            try:
                health_status["mcp_healthy"] = self.mcp_client.health_check()
            except Exception as e:
                logger.error(f"MCP health check failed: {str(e)}")
                health_status["mcp_error"] = str(e)
        
        return health_status
    
    def close(self):
        """Close connections and clean up"""
        if self.mcp_client:
            self.mcp_client.close()
            logger.info("Data access layer closed")

# Global instance
data_access = EnhancedDataAccess()
