"""
Customer Information Resource for MCP Server
Provides access to customer data and credit information
"""

import logging
from typing import Dict, Any

# Removed unused import: Optional
from datetime import datetime

logger = logging.getLogger("mcp_server.customer_info")


class CustomerInfoResource:
    """Resource for customer information"""

    def __init__(self, db):
        """Initialize the resource with a database connection"""
        self.db = db
        logger.info("CustomerInfoResource initialized")

    def get_customer_info(self, customer_id: str) -> Dict[str, Any]:
        """Get customer information by ID"""
        logger.info(f"Getting customer info for ID: {customer_id}")

        customer = self.db.get_customer(customer_id)
        if not customer:
            logger.error(f"Customer with ID {customer_id} not found")
            raise ValueError(f"Customer with ID {customer_id} not found")

        # Calculate age from DOB
        dob = datetime.strptime(customer["dob"], "%Y-%m-%d")
        today = datetime.now()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

        # Add calculated fields
        customer_info = {
            **customer,
            "age": age,
            "full_name": f"{customer['first_name']} {customer['last_name']}",
            "address_formatted": f"{customer['address']['street']}, {customer['address']['city']}, {customer['address']['state']} {customer['address']['zip']}",
        }

        # Remove sensitive information
        if "ssn" in customer_info:
            del customer_info["ssn"]

        return {"status": "success", "customer_info": customer_info}

    def get_credit_info(self, customer_id: str) -> Dict[str, Any]:
        """Get credit information for a customer"""
        logger.info(f"Getting credit info for customer ID: {customer_id}")

        credit_report = self.db.get_credit_report(customer_id)
        if not credit_report:
            logger.error(f"Credit report for customer ID {customer_id} not found")
            raise ValueError(f"Credit report for customer ID {customer_id} not found")

        # Add risk assessment based on credit score
        credit_score = credit_report["credit_score"]
        if credit_score >= 750:
            risk_level = "low"
        elif credit_score >= 650:
            risk_level = "medium"
        else:
            risk_level = "high"

        credit_info = {**credit_report, "risk_level": risk_level}

        return {"status": "success", "credit_info": credit_info}
