"""
Vehicle Information Resource for MCP Server
Provides access to vehicle data and safety information
"""

import logging
from typing import Dict, Any

# Removed unused import: Optional
from datetime import datetime

logger = logging.getLogger("mcp_server.vehicle_info")


class VehicleInfoResource:
    """Resource for vehicle information"""

    def __init__(self, db):
        """Initialize the resource with a database connection"""
        self.db = db
        logger.info("VehicleInfoResource initialized")

    def get_vehicle_info(self, make: str, model: str, year: int) -> Dict[str, Any]:
        """Get vehicle information by make, model, and year"""
        logger.info(f"Getting vehicle info for: {year} {make} {model}")

        vehicle = self.db.get_vehicle(make, model, year)
        if not vehicle:
            logger.error(f"Vehicle information for {make} {model} {year} not found")
            raise ValueError(f"Vehicle information for {make} {model} {year} not found")

        # Calculate vehicle age
        today = datetime.now()
        vehicle_age = today.year - year

        # Add calculated fields
        vehicle_info = {
            **vehicle,
            "age": vehicle_age,
            "display_name": f"{year} {vehicle['make']} {vehicle['model']}",
            "is_new": vehicle_age <= 3,
        }

        # Add value depreciation based on age
        if vehicle_age <= 1:
            depreciation_factor = 0.8  # 20% depreciation in first year
        elif vehicle_age <= 3:
            depreciation_factor = 0.7  # 30% depreciation in 2-3 years
        elif vehicle_age <= 5:
            depreciation_factor = 0.6  # 40% depreciation in 4-5 years
        else:
            depreciation_factor = 0.5  # 50% depreciation after 5 years

        vehicle_info["current_value"] = round(
            vehicle_info["value"] * depreciation_factor, 2
        )

        return {"status": "success", "vehicle_info": vehicle_info}

    def get_safety_rating(self, make: str, model: str) -> Dict[str, Any]:
        """Get safety rating for a vehicle by make and model"""
        logger.info(f"Getting safety rating for: {make} {model}")

        safety_rating = self.db.get_safety_rating(make, model)
        if safety_rating is None:
            logger.error(f"Safety rating for {make} {model} not found")
            raise ValueError(f"Safety rating for {make} {model} not found")

        # Add safety assessment based on rating
        if safety_rating >= 4:
            safety_assessment = "excellent"
        elif safety_rating >= 3:
            safety_assessment = "good"
        else:
            safety_assessment = "average"

        return {
            "status": "success",
            "safety_info": {
                "make": make,
                "model": model,
                "safety_rating": safety_rating,
                "safety_assessment": safety_assessment,
            },
        }
