"""
Enhanced FastAPI application for Auto Insurance Quote System
Integrates with the multi-agent workflow system
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import json
import os
import boto3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# Import our enhanced agent system
from agent_system_enhanced import process_quote_request, get_system_health
from tracing import get_traces, clear_traces, enable_tracing, disable_tracing

app = FastAPI(title="Enhanced Auto Insurance Quote API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development only - restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data paths
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
CUSTOMERS_PATH = os.path.join(DATA_DIR, "customers.json")
PRODUCTS_PATH = os.path.join(DATA_DIR, "products.json")
VEHICLES_PATH = os.path.join(DATA_DIR, "vehicles.json")

# Get AWS region from environment or use default
aws_region = os.getenv("AWS_REGION", "us-west-2")

# Initialize Bedrock client for chat processing
bedrock_client = boto3.client(service_name="bedrock-runtime", region_name=aws_region)

# Load data functions
def load_json_data(file_path):
    try:
        with open(file_path, "r") as file:
            return json.load(file)
    except Exception as e:
        print(f"Error loading {file_path}: {e}")
        return {}

# Enhanced Request/Response Models
class VehicleInfo(BaseModel):
    make: str
    model: str
    year: int
    vin: Optional[str] = None
    value: Optional[float] = None

class QuoteRequest(BaseModel):
    customer_id: str
    vehicle_info: VehicleInfo
    coverage_type: Optional[str] = None  # Optional preferred coverage type

class QuoteResponse(BaseModel):
    quote_id: str
    customer: Dict[str, Any]
    vehicle: Dict[str, Any]
    coverage: Dict[str, Any]
    premium: Dict[str, Any]
    risk_factors: Dict[str, Any]
    valid_until: str
    generated_at: str
    processing_metadata: Optional[Dict[str, Any]] = None

class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    customer_id: str
    messages: List[ChatMessage]

class ChatResponse(BaseModel):
    response: str
    extracted_info: Optional[Dict[str, Any]] = None
    quote: Optional[QuoteResponse] = None
    agent_traces: Optional[List[Dict[str, Any]]] = None

# Basic endpoints
@app.get("/")
def read_root():
    return {"message": "Enhanced Auto Insurance Quote API with Multi-Agent System"}

@app.get("/customers")
def get_customers():
    data = load_json_data(CUSTOMERS_PATH)
    return data.get("customers", [])

@app.get("/customers/{customer_id}")
def get_customer(customer_id: str):
    data = load_json_data(CUSTOMERS_PATH)
    customers = data.get("customers", [])
    
    for customer in customers:
        if customer["id"] == customer_id:
            return customer
    
    raise HTTPException(status_code=404, detail="Customer not found")

@app.get("/products")
def get_products():
    data = load_json_data(PRODUCTS_PATH)
    return data.get("products", [])

@app.get("/vehicles")
def get_vehicles():
    data = load_json_data(VEHICLES_PATH)
    return data.get("vehicles", [])

# Enhanced Quote Generation Endpoint
@app.post("/api/quotes", response_model=QuoteResponse)
async def generate_quote(request: QuoteRequest):
    """
    Generate an auto insurance quote using the enhanced multi-agent system.
    
    This endpoint triggers the enhanced quote generation workflow which:
    1. Retrieves and validates customer information
    2. Analyzes vehicle details
    3. Assesses risk factors
    4. Determines appropriate coverage
    5. Calculates premium
    6. Generates final quote
    """
    try:
        # Enable tracing for this request
        enable_tracing()
        clear_traces()
        
        # Convert Pydantic model to dict for vehicle info
        vehicle_info = request.vehicle_info.dict()
        
        # Process quote request through enhanced agent workflow
        result = process_quote_request(request.customer_id, vehicle_info)
        
        if "error" in result:
            raise HTTPException(
                status_code=400,
                detail=f"Quote generation failed: {result['error']}"
            )
        
        # Extract the final quote from the result
        quote = result["final_quote"]
        
        # Include processing metadata if available
        if "processing_metadata" in result:
            quote["processing_metadata"] = result["processing_metadata"]
        
        return quote
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating quote: {str(e)}"
        )
    finally:
        # Disable tracing after request is complete
        disable_tracing()

# Legacy quote endpoint for backward compatibility
@app.post("/quotes", response_model=QuoteResponse)
def create_quote_legacy(request: QuoteRequest):
    """Legacy quote endpoint - redirects to enhanced API"""
    return generate_quote(request)

# Chat endpoint with enhanced agent integration
@app.post("/chat", response_model=ChatResponse)
def process_chat(request: ChatRequest):
    """
    Process a chat message using Anthropic Claude via Amazon Bedrock
    and integrate with the enhanced multi-agent system for quote generation.
    """
    # Clear previous traces
    clear_traces()
    enable_tracing()

    # Get the last user message
    last_message = None
    for message in reversed(request.messages):
        if message.role == "user":
            last_message = message.content
            break

    if not last_message:
        return ChatResponse(
            response="I don't see a message from you. How can I help you with auto insurance?"
        )

    try:
        # Extract vehicle information and coverage details from conversation
        vehicle_info = {}
        coverage_level = None

        # Extract vehicle make
        makes = ["toyota", "honda", "ford", "bmw", "tesla", "chevrolet", "nissan", "hyundai"]
        for make in makes:
            if make in last_message.lower():
                vehicle_info["make"] = make.capitalize()
                break

        # Extract vehicle model (simplified - would need more robust extraction in production)
        common_models = {
            "toyota": ["camry", "corolla", "rav4", "highlander", "tacoma", "prius"],
            "honda": ["civic", "accord", "cr-v", "pilot", "odyssey"],
            "ford": ["f-150", "ranger", "escape", "explorer", "mustang"],
            "bmw": ["3 series", "5 series", "x3", "x5", "i4"],
            "tesla": ["model 3", "model y", "model s", "model x"],
            "chevrolet": ["silverado", "equinox", "malibu", "tahoe"],
        }

        if "make" in vehicle_info:
            for model in common_models.get(vehicle_info["make"].lower(), []):
                if model.lower() in last_message.lower():
                    vehicle_info["model"] = model.title()
                    break

        # Extract vehicle year
        for year in range(2018, 2026):
            if str(year) in last_message:
                vehicle_info["year"] = year
                break

        # Extract coverage level
        if "basic" in last_message.lower():
            coverage_level = "basic"
        elif "standard" in last_message.lower():
            coverage_level = "standard"
        elif "premium" in last_message.lower():
            coverage_level = "premium"

        # Check if we have enough information to generate a quote
        has_complete_info = (
            "make" in vehicle_info
            and "model" in vehicle_info
            and "year" in vehicle_info
        )

        # Format messages for Claude
        formatted_messages = []
        for msg in request.messages:
            formatted_messages.append({
                "role": "user" if msg.role == "user" else "assistant",
                "content": msg.content,
            })

        # Add system prompt
        system_prompt = """You are an auto insurance assistant powered by an advanced multi-agent system. 
Help the customer get a quote for their vehicle by extracting the following information:
- Vehicle make (Toyota, Honda, Ford, BMW, Tesla, Chevrolet, etc.)
- Vehicle model
- Vehicle year (between 2018-2025)

If any information is missing, ask for it conversationally. Be helpful and friendly.

When you have the vehicle make, model, and year, tell the customer you're generating their personalized quote using our advanced risk assessment system.
"""

        # Generate a quote if we have all the necessary information
        quote_result = None
        if has_complete_info:
            print(f"DEBUG - Generating enhanced quote with: {vehicle_info}")
            try:
                # Process quote request through enhanced agent workflow
                result = process_quote_request(request.customer_id, vehicle_info)
                
                if "error" not in result:
                    quote_result = result["final_quote"]
                    print(f"DEBUG - Enhanced quote generated successfully: {quote_result['quote_id']}")
                    print(f"DEBUG - Generated {len(get_traces())} agent traces")
                else:
                    print(f"ERROR - Failed to generate quote: {result['error']}")

            except Exception as e:
                print(f"ERROR - Failed to generate enhanced quote: {e}")

        # Call Claude via Bedrock
        response = bedrock_client.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "system": system_prompt,
                "messages": formatted_messages,
                "temperature": 0.7,
            }),
        )

        response_body = json.loads(response.get("body").read())
        assistant_response = response_body.get("content")[0].get("text")

        # If we have a quote, append it to the assistant's response
        if quote_result:
            quote_summary = f"""
🎉 **Your Personalized Auto Insurance Quote**

**Quote ID:** {quote_result["quote_id"]}
**Vehicle:** {quote_result["vehicle"]["year"]} {quote_result["vehicle"]["make"]} {quote_result["vehicle"]["model"]}
**Vehicle Value:** ${quote_result["vehicle"]["value"]:,}

**Recommended Coverage:** {quote_result["coverage"]["product"]["name"]}
**Reasoning:** {quote_result["coverage"]["reasoning"]}

**Premium Breakdown:**
- Base Premium: ${quote_result["premium"]["breakdown"]["base_premium"]:,.2f}
- Risk Multiplier: {quote_result["premium"]["breakdown"]["risk_multiplier"]:.2f}x
- Vehicle Factor: {quote_result["premium"]["breakdown"]["vehicle_factor"]:.2f}x
- Discounts Applied: {len(quote_result["premium"]["breakdown"]["discounts"])} discount(s)

**🎯 Your Total Premium: ${quote_result["premium"]["amount"]:,.2f}/year**

**Risk Assessment:**
- Overall Risk Level: {quote_result["risk_factors"]["overall_risk"].title()}
- Customer Age: {quote_result["risk_factors"]["age"]} years
- Driving History: {quote_result["risk_factors"]["accidents"]} accident(s), {quote_result["risk_factors"]["violations"]} violation(s)
- Credit Risk: {quote_result["risk_factors"]["credit_risk"].title()}

**Quote Valid Until:** {quote_result["valid_until"][:10]}

Would you like to proceed with this quote or explore other coverage options?
"""
            assistant_response = f"{assistant_response}\n\n{quote_summary}"

        return ChatResponse(
            response=assistant_response,
            extracted_info=vehicle_info if vehicle_info else None,
            quote=quote_result,
            agent_traces=get_traces(),
        )
        
    except Exception as e:
        print(f"Error processing chat: {e}")
        return ChatResponse(
            response="I apologize, but I encountered an error processing your request. Please try again."
        )
    finally:
        disable_tracing()

# System endpoints
@app.get("/api/system/health")
async def check_system_health():
    """Check the health of the enhanced quote generation system"""
    try:
        return get_system_health()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error checking system health: {str(e)}"
        )

@app.get("/api/system/traces")
async def get_system_traces():
    """Get the traces from the most recent quote generation"""
    try:
        traces = get_traces()
        return {
            "trace_count": len(traces),
            "traces": traces
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error retrieving traces: {str(e)}"
        )

@app.get("/agent-traces")
def get_agent_traces():
    """Legacy endpoint for agent traces"""
    traces = get_traces()
    return {"traces": traces}

if __name__ == "__main__":
    uvicorn.run("app_enhanced:app", host="0.0.0.0", port=8000, reload=True)
