"""
Enhanced MCP Client for Auto Insurance Quote System

This client provides comprehensive access to all data sources needed by the
multi-agent insurance quote system, including customer information, vehicle data,
pricing rules, insurance products, and policy information.
"""

import requests
import logging
import json
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger("backend.mcp_client")


class MCPClient:
    """Enhanced client for interacting with the MCP Server for insurance quote processing"""

    def __init__(self, base_url="http://localhost:8001", timeout=30):
        """Initialize the MCP client with the server URL and timeout"""
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.session = requests.Session()
        logger.info(f"MCP Client initialized with base URL: {base_url}")

    def _make_request(self, endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Make a standardized request to the MCP server with error handling"""
        try:
            url = f"{self.base_url}/{endpoint.lstrip('/')}"
            logger.debug(f"Making request to {url} with payload: {payload}")
            
            response = self.session.post(url, json=payload, timeout=self.timeout)
            response.raise_for_status()

            data = response.json()
            if data.get("status") != "success":
                error_msg = data.get('error', 'Unknown error')
                logger.error(f"MCP server returned error for {endpoint}: {error_msg}")
                raise ValueError(f"Error from MCP server: {error_msg}")

            logger.debug(f"Successfully received data from {endpoint}")
            return data
        except requests.RequestException as e:
            logger.error(f"Network error calling MCP server endpoint {endpoint}: {str(e)}")
            raise ValueError(f"Network error accessing {endpoint}: {str(e)}")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response from MCP server endpoint {endpoint}: {str(e)}")
            raise ValueError(f"Invalid response format from {endpoint}: {str(e)}")

    # Customer Information Endpoints
    def get_customer_info(self, customer_id: str) -> Dict[str, Any]:
        """Get comprehensive customer information from the MCP server"""
        payload = {"customer_id": customer_id}
        data = self._make_request("customer_info", payload)
        return data.get("customer_info", {})

    def get_customer_credit(self, customer_id: str) -> Dict[str, Any]:
        """Get customer credit information from the MCP server"""
        payload = {"customer_id": customer_id}
        data = self._make_request("customer_credit", payload)
        return data.get("credit_info", {})

    def get_customer_driving_history(self, customer_id: str) -> Dict[str, Any]:
        """Get customer driving history from the MCP server"""
        payload = {"customer_id": customer_id}
        data = self._make_request("customer_driving_history", payload)
        return data.get("driving_history", {})

    def get_customer_policies(self, customer_id: str) -> List[Dict[str, Any]]:
        """Get existing customer policies from the MCP server"""
        payload = {"customer_id": customer_id}
        data = self._make_request("customer_policies", payload)
        return data.get("policies", [])

    # Vehicle Information Endpoints
    def get_vehicle_info(self, make: str, model: str, year: int) -> Dict[str, Any]:
        """Get comprehensive vehicle information from the MCP server"""
        payload = {"make": make, "model": model, "year": year}
        data = self._make_request("vehicle_info", payload)
        return data.get("vehicle_info", {})

    def get_vehicle_by_vin(self, vin: str) -> Dict[str, Any]:
        """Get vehicle information by VIN from the MCP server"""
        payload = {"vin": vin}
        data = self._make_request("vehicle_by_vin", payload)
        return data.get("vehicle_info", {})

    def get_vehicle_safety_rating(self, make: str, model: str, year: Optional[int] = None) -> Dict[str, Any]:
        """Get vehicle safety rating from the MCP server"""
        payload = {"make": make, "model": model}
        if year:
            payload["year"] = year
        data = self._make_request("vehicle_safety", payload)
        return data.get("safety_info", {})

    def get_vehicle_theft_rating(self, make: str, model: str, year: int) -> Dict[str, Any]:
        """Get vehicle theft rating and statistics from the MCP server"""
        payload = {"make": make, "model": model, "year": year}
        data = self._make_request("vehicle_theft_rating", payload)
        return data.get("theft_info", {})

    def get_vehicle_market_value(self, make: str, model: str, year: int, mileage: Optional[int] = None) -> Dict[str, Any]:
        """Get current market value for a vehicle from the MCP server"""
        payload = {"make": make, "model": model, "year": year}
        if mileage:
            payload["mileage"] = mileage
        data = self._make_request("vehicle_market_value", payload)
        return data.get("market_value", {})

    # Insurance Product and Pricing Endpoints
    def get_insurance_products(self, state: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get available insurance products from the MCP server"""
        payload = {}
        if state:
            payload["state"] = state
        data = self._make_request("insurance_products", payload)
        return data.get("products", [])

    def get_pricing_rules(self, state: Optional[str] = None) -> Dict[str, Any]:
        """Get pricing rules and factors from the MCP server"""
        payload = {}
        if state:
            payload["state"] = state
        data = self._make_request("pricing_rules", payload)
        return data.get("pricing_rules", {})

    def get_discount_eligibility(self, customer_id: str, vehicle_info: Dict[str, Any]) -> Dict[str, Any]:
        """Check discount eligibility for a customer and vehicle"""
        payload = {"customer_id": customer_id, "vehicle_info": vehicle_info}
        data = self._make_request("discount_eligibility", payload)
        return data.get("discounts", {})

    # Risk Assessment Endpoints
    def get_risk_factors(self, customer_id: str, vehicle_info: Dict[str, Any]) -> Dict[str, Any]:
        """Get comprehensive risk factors from the MCP server"""
        payload = {"customer_id": customer_id, "vehicle_info": vehicle_info}
        data = self._make_request("risk_factors", payload)
        return data.get("risk_factors", {})

    def get_geographic_risk(self, zip_code: str) -> Dict[str, Any]:
        """Get geographic risk factors based on location"""
        payload = {"zip_code": zip_code}
        data = self._make_request("geographic_risk", payload)
        return data.get("geographic_risk", {})

    # Quote and Policy Management Endpoints
    def save_quote(self, quote_data: Dict[str, Any]) -> Dict[str, Any]:
        """Save a generated quote to the MCP server"""
        payload = {"quote_data": quote_data}
        data = self._make_request("save_quote", payload)
        return data.get("quote_id", {})

    def get_quote_history(self, customer_id: str) -> List[Dict[str, Any]]:
        """Get quote history for a customer"""
        payload = {"customer_id": customer_id}
        data = self._make_request("quote_history", payload)
        return data.get("quotes", [])

    def validate_coverage_requirements(self, state: str, coverage: Dict[str, Any]) -> Dict[str, Any]:
        """Validate coverage meets state requirements"""
        payload = {"state": state, "coverage": coverage}
        data = self._make_request("validate_coverage", payload)
        return data.get("validation_result", {})

    # External Data Integration Endpoints
    def get_dmv_record(self, customer_id: str, license_number: str, state: str) -> Dict[str, Any]:
        """Get DMV record from external integration"""
        payload = {"customer_id": customer_id, "license_number": license_number, "state": state}
        data = self._make_request("dmv_record", payload)
        return data.get("dmv_record", {})

    def get_claims_history(self, customer_id: str) -> List[Dict[str, Any]]:
        """Get claims history from external systems"""
        payload = {"customer_id": customer_id}
        data = self._make_request("claims_history", payload)
        return data.get("claims", [])

    def verify_identity(self, customer_info: Dict[str, Any]) -> Dict[str, Any]:
        """Verify customer identity through external services"""
        payload = {"customer_info": customer_info}
        data = self._make_request("verify_identity", payload)
        return data.get("identity_verification", {})

    # Utility Methods
    def health_check(self) -> bool:
        """Check if the MCP server is healthy and responsive"""
        try:
            data = self._make_request("health", {})
            return data.get("status") == "healthy"
        except Exception as e:
            logger.error(f"Health check failed: {str(e)}")
            return False

    def get_server_info(self) -> Dict[str, Any]:
        """Get information about the MCP server capabilities"""
        try:
            data = self._make_request("server_info", {})
            return data.get("server_info", {})
        except Exception as e:
            logger.error(f"Failed to get server info: {str(e)}")
            return {}

    def close(self):
        """Close the session and clean up resources"""
        if self.session:
            self.session.close()
            logger.info("MCP Client session closed")

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.close()
