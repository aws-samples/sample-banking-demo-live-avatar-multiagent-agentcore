"""
Database connection and operations for the MCP server
Currently uses JSON files as a mock database, but can be extended to use real databases
"""

import os
import json
import logging
from typing import Dict, Any, Optional
# Removed unused import: List

logger = logging.getLogger("mcp_server.database")


class Database:
    """Database class for the MCP server"""

    def __init__(self):
        """Initialize the database connection"""
        # Set up paths to data files
        self.base_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        self.data_dir = os.path.join(self.base_dir, "data")

        self.customers_path = os.path.join(self.data_dir, "customers.json")
        self.credit_reports_path = os.path.join(self.data_dir, "credit_reports.json")
        self.vehicles_path = os.path.join(self.data_dir, "vehicles.json")
        self.products_path = os.path.join(self.data_dir, "products.json")
        self.pricing_rules_path = os.path.join(self.data_dir, "pricing_rules.json")

        # Load data
        self.load_data()

        logger.info("Database initialized")

    def load_data(self):
        """Load data from JSON files"""
        try:
            with open(self.customers_path, "r") as f:
                self.customers_data = json.load(f)

            with open(self.credit_reports_path, "r") as f:
                self.credit_reports_data = json.load(f)

            with open(self.vehicles_path, "r") as f:
                self.vehicles_data = json.load(f)

            with open(self.products_path, "r") as f:
                self.products_data = json.load(f)

            with open(self.pricing_rules_path, "r") as f:
                self.pricing_rules_data = json.load(f)

            logger.info("Data loaded successfully")
        except Exception as e:
            logger.error(f"Error loading data: {str(e)}")
            raise

    def get_customer(self, customer_id: str) -> Optional[Dict[str, Any]]:
        """Get customer information by ID"""
        customers = self.customers_data.get("customers", [])
        for customer in customers:
            if customer["id"] == customer_id:
                return customer
        return None

    def get_credit_report(self, customer_id: str) -> Optional[Dict[str, Any]]:
        """Get credit report by customer ID"""
        credit_reports = self.credit_reports_data.get("reports", [])
        for report in credit_reports:
            if report["customer_id"] == customer_id:
                return report
        return None

    def get_vehicle(self, make: str, model: str, year: int) -> Optional[Dict[str, Any]]:
        """Get vehicle information by make, model, and year"""
        vehicles = self.vehicles_data.get("vehicles", [])
        for vehicle in vehicles:
            if (
                vehicle["make"].lower() == make.lower()
                and vehicle["model"].lower() == model.lower()
                and year in vehicle["years"]
            ):
                # Create a vehicle info object with the specific year
                vehicle_info = {
                    "make": vehicle["make"],
                    "model": vehicle["model"],
                    "year": year,
                    "category": vehicle["category"],
                    "safety_rating": vehicle["safety_rating"],
                    "value": vehicle["base_value"].get(str(year)),
                }
                return vehicle_info
        return None

    def get_safety_rating(self, make: str, model: str) -> Optional[int]:
        """Get safety rating for a vehicle by make and model"""
        vehicles = self.vehicles_data.get("vehicles", [])
        for vehicle in vehicles:
            if (
                vehicle["make"].lower() == make.lower()
                and vehicle["model"].lower() == model.lower()
            ):
                return vehicle["safety_rating"]
        return None

    def get_pricing_rules(self) -> Dict[str, Any]:
        """Get pricing rules"""
        return self.pricing_rules_data

    def get_products(self) -> Dict[str, Any]:
        """Get insurance products"""
        return self.products_data
