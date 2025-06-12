#!/usr/bin/env python3
"""
MCP Server for Auto Insurance Quote System
Provides resources for customer information and vehicle information
"""

# Removed unused imports: os, json
import logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
# Removed unused imports: Dict, Any, List, Optional

# Import resources
from resources.customer_info import CustomerInfoResource
from resources.vehicle_info import VehicleInfoResource
from db.database import Database

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("mcp_server")

# Initialize FastAPI app
app = FastAPI(title="Auto Insurance MCP Server")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development only - restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
db = Database()

# Initialize resources
customer_info_resource = CustomerInfoResource(db)
vehicle_info_resource = VehicleInfoResource(db)


@app.get("/")
async def root():
    """Root endpoint for the MCP server"""
    return {
        "name": "Auto Insurance MCP Server",
        "version": "1.0.0",
        "resources": ["customer_info", "vehicle_info"],
    }


@app.post("/customer_info")
async def get_customer_info(request: Request):
    """Get customer information"""
    try:
        data = await request.json()
        customer_id = data.get("customer_id")
        if not customer_id:
            raise HTTPException(status_code=400, detail="Missing customer_id parameter")

        result = customer_info_resource.get_customer_info(customer_id)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Error in customer_info endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/customer_credit")
async def get_customer_credit(request: Request):
    """Get customer credit information"""
    try:
        data = await request.json()
        customer_id = data.get("customer_id")
        if not customer_id:
            raise HTTPException(status_code=400, detail="Missing customer_id parameter")

        result = customer_info_resource.get_credit_info(customer_id)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Error in customer_credit endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vehicle_info")
async def get_vehicle_info(request: Request):
    """Get vehicle information"""
    try:
        data = await request.json()
        make = data.get("make")
        model = data.get("model")
        year = data.get("year")

        if not all([make, model, year]):
            raise HTTPException(
                status_code=400, detail="Missing required parameters: make, model, year"
            )

        result = vehicle_info_resource.get_vehicle_info(make, model, year)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Error in vehicle_info endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/vehicle_safety")
async def get_vehicle_safety(request: Request):
    """Get vehicle safety information"""
    try:
        data = await request.json()
        make = data.get("make")
        model = data.get("model")

        if not all([make, model]):
            raise HTTPException(
                status_code=400, detail="Missing required parameters: make, model"
            )

        result = vehicle_info_resource.get_safety_rating(make, model)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Error in vehicle_safety endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)
