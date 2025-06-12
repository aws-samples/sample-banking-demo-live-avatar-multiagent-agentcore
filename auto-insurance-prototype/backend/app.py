from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import json
import os
import boto3

# Removed unused import: time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uvicorn
from fastapi.middleware.cors import CORSMiddleware

# Import our enhanced agent system
from agent_system_enhanced import process_quote_request, get_system_health
from tracing import get_traces, clear_traces, enable_tracing, disable_tracing

app = FastAPI(title="Enhanced Auto Insurance Quote API with Multi-Agent System")

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
CREDIT_REPORTS_PATH = os.path.join(DATA_DIR, "credit_reports.json")
POLICIES_PATH = os.path.join(DATA_DIR, "policies.json")
PRODUCTS_PATH = os.path.join(DATA_DIR, "products.json")
PRICING_RULES_PATH = os.path.join(DATA_DIR, "pricing_rules.json")
VEHICLES_PATH = os.path.join(DATA_DIR, "vehicles.json")

# Get AWS region from environment or use default
aws_region = os.getenv("AWS_REGION", "us-west-2")

# Global variable to store agent traces
agent_traces = []

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

class EnhancedQuoteRequest(BaseModel):
    customer_id: str
    vehicle_info: VehicleInfo
    coverage_type: Optional[str] = None  # Optional preferred coverage type

class EnhancedQuoteResponse(BaseModel):
    quote_id: str
    customer: Dict[str, Any]
    vehicle: Dict[str, Any]
    coverage: Dict[str, Any]
    premium: Dict[str, Any]
    risk_factors: Dict[str, Any]
    valid_until: str
    generated_at: str
    processing_metadata: Optional[Dict[str, Any]] = None
class QuoteRequest(BaseModel):
    customer_id: str
    vehicle_make: str
    vehicle_model: str
    vehicle_year: int
    coverage_level: str  # "basic", "standard", "premium"
    deductible: int
    additional_coverage: List[str] = []


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    customer_id: str
    messages: List[ChatMessage]


# Response models
class QuoteResponse(BaseModel):
    quote_id: str
    customer_id: str
    vehicle_info: Dict[str, Any]
    coverage_details: Dict[str, Any]
    premium: float
    discounts: List[Dict[str, Any]]
    total_premium: float
    valid_until: str


class ChatResponse(BaseModel):
    response: str
    extracted_info: Optional[Dict[str, Any]] = None
    quote: Optional[QuoteResponse] = None
    agent_traces: Optional[List[Dict[str, Any]]] = None


class AgentTrace(BaseModel):
    agentId: str
    status: str  # started, completed, error
    timestamp: str
    input: Optional[Dict[str, Any]] = None
    output: Optional[Dict[str, Any]] = None
    reasoning: Optional[str] = None


# Removed duplicate AgentTrace class definition


@app.get("/")
def read_root():
    return {
        "message": "Enhanced Auto Insurance Quote API with Multi-Agent System",
        "features": [
            "Multi-Agent Quote Generation",
            "MCP Server Integration with Fallback",
            "Comprehensive Risk Assessment", 
            "Real-time Processing Traces",
            "Enhanced Chat Interface"
        ],
        "endpoints": {
            "enhanced_quotes": "/api/quotes",
            "legacy_quotes": "/quotes", 
            "chat": "/chat",
            "health": "/api/system/health",
            "traces": "/api/system/traces"
        }
    }


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


@app.post("/quotes", response_model=QuoteResponse)
def create_quote(request: QuoteRequest):
    """Generate an auto insurance quote using the enhanced multi-agent system"""
    # Clear previous traces
    clear_traces()
    enable_tracing()
    
    try:
        # Create vehicle info dictionary
        vehicle_info = {
            "make": request.vehicle_make,
            "model": request.vehicle_model,
            "year": request.vehicle_year
        }
        
        # Process the quote through enhanced agent system
        result = process_quote_request(request.customer_id, vehicle_info)
        
        if "error" in result:
            raise HTTPException(
                status_code=400,
                detail=f"Quote generation failed: {result['error']}"
            )
        
        # Return the quote
        return result["final_quote"]
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        disable_tracing()


@app.get("/agent-traces")
def get_agent_traces():
    """Get the current agent traces"""
    traces = get_traces()
    print(f"DEBUG - Returning {len(traces)} agent traces")
    return {"traces": traces}


# Enhanced API Endpoints
@app.post("/api/quotes", response_model=EnhancedQuoteResponse)
async def generate_quote_enhanced(request: EnhancedQuoteRequest):
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


@app.post("/chat", response_model=ChatResponse)
def process_chat(request: ChatRequest):
    """
    Process a chat message using Anthropic Claude via Amazon Bedrock
    and integrate with the enhanced multi-agent system for quote generation.
    
    This endpoint REQUIRES AWS Bedrock to be available and will fail if it's not accessible.
    This ensures the application remains strictly LLM-powered.
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
        raise HTTPException(
            status_code=400,
            detail="No user message found in the conversation"
        )

    try:
        # Extract vehicle information and coverage details from the ENTIRE conversation
        vehicle_info = {}
        coverage_level = None

        # Combine all user messages to extract information
        all_user_messages = []
        for message in request.messages:
            if message.role == "user":
                all_user_messages.append(message.content.lower())
        
        # Join all user messages for comprehensive extraction
        combined_user_text = " ".join(all_user_messages)
        print(f"DEBUG - Combined user text for extraction: {combined_user_text}")

        # Extract vehicle make
        makes = ["toyota", "honda", "ford", "bmw", "tesla", "chevrolet", "nissan", "hyundai"]
        for make in makes:
            if make in combined_user_text:
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
                if model.lower() in combined_user_text:
                    vehicle_info["model"] = model.title()
                    break

        # Extract vehicle year
        for year in range(2018, 2026):
            if str(year) in combined_user_text:
                vehicle_info["year"] = year
                break

        # Extract coverage level
        if "basic" in combined_user_text:
            coverage_level = "basic"
        elif "standard" in combined_user_text:
            coverage_level = "standard"
        elif "premium" in combined_user_text:
            coverage_level = "premium"

        print(f"DEBUG - Extracted vehicle info: {vehicle_info}")

        # Check if we have enough information to generate a quote
        has_complete_info = (
            "make" in vehicle_info
            and "model" in vehicle_info
            and "year" in vehicle_info
        )

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
                import traceback
                traceback.print_exc()

        # Format messages for Claude - ensure first message is from user
        formatted_messages = []
        
        # Process all messages and ensure proper format
        for msg in request.messages:
            formatted_messages.append({
                "role": "user" if msg.role == "user" else "assistant",
                "content": msg.content,
            })
        
        # Ensure the first message is from user (Bedrock requirement)
        if not formatted_messages or formatted_messages[0]["role"] != "user":
            # If no user message or first message isn't from user, add a default user message
            formatted_messages.insert(0, {
                "role": "user",
                "content": "Hello, I'm interested in getting an auto insurance quote."
            })
        
        # Remove any empty messages
        formatted_messages = [msg for msg in formatted_messages if msg["content"].strip()]

        # Add system prompt with quote information if available
        system_prompt = """You are an auto insurance assistant powered by an advanced multi-agent system. 

Your primary tasks:
1. Help customers get quotes by collecting vehicle information:
   - Vehicle make (Toyota, Honda, Ford, BMW, Tesla, Chevrolet, etc.)
   - Vehicle model
   - Vehicle year (between 2018-2025)

2. When you have complete vehicle information, tell them you're generating their quote

3. When a quote is provided to you in this system prompt, you MUST present ALL the quote details to the customer immediately - do not say you're still generating it.

Be helpful, friendly, and conversational. Always present complete information when available."""

        # If we have a complete quote, include it in the system prompt
        if quote_result:
            quote_summary = f"""

A quote has been generated and you MUST present ALL of the following details to the customer:

QUOTE DETAILS (present all of these):
- Quote ID: {quote_result["quote_id"]}
- Vehicle: {quote_result["vehicle"]["year"]} {quote_result["vehicle"]["make"]} {quote_result["vehicle"]["model"]}
- Vehicle Value: ${quote_result["vehicle"]["value"]:,}
- Coverage Type: {quote_result["coverage"]["product"]["name"]}
- Coverage Details: {quote_result["coverage"]["reasoning"]}

PREMIUM BREAKDOWN (present all of these):
- Base Premium: ${quote_result["premium"]["breakdown"]["base_premium"]:,.2f}
- Risk Factors Applied: {quote_result["premium"]["breakdown"]["risk_multiplier"]:.2f}x
- Vehicle Factor: {quote_result["premium"]["breakdown"]["vehicle_factor"]:.2f}x
- Number of Discounts: {len(quote_result["premium"]["breakdown"]["discounts"])}
- Final Annual Premium: ${quote_result["premium"]["amount"]:,.2f}

RISK ASSESSMENT:
- Overall Risk Level: {quote_result["risk_factors"]["overall_risk"].title()}
- Age Factor: {quote_result["risk_factors"]["age"]} years
- Driving History: {quote_result["risk_factors"]["accidents"]} accident(s), {quote_result["risk_factors"]["violations"]} violation(s)
- Credit Risk Level: {quote_result["risk_factors"]["credit_risk"].title()}

Quote Valid Until: {quote_result["valid_until"][:10]}

IMPORTANT INSTRUCTIONS:
1. Present ALL of the above information in a clear, organized way
2. Use a friendly, professional tone
3. Format the numbers nicely (with commas for thousands)
4. Explain what each factor means for the customer
5. End by asking if they would like to:
   - Proceed with this quote
   - Explore different coverage options
   - Learn more about any specific aspect of the quote"""
            
            system_prompt += quote_summary

        print(f"DEBUG - Sending {len(formatted_messages)} messages to Bedrock")
        print(f"DEBUG - First message role: {formatted_messages[0]['role'] if formatted_messages else 'None'}")

        # Call Claude via Bedrock - THIS IS REQUIRED, NO FALLBACK
        try:
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
            
            print("DEBUG - Successfully used Bedrock for response generation")
            
        except Exception as e:
            print(f"ERROR - Bedrock call failed: {str(e)}")
            # NO FALLBACK - Raise HTTP exception to indicate service unavailable
            raise HTTPException(
                status_code=503,
                detail=f"LLM service (AWS Bedrock) is currently unavailable. This chat requires AI processing to function. Error: {str(e)}"
            )

        # Transform quote to expected format if available
        transformed_quote = None
        if quote_result:
            try:
                transformed_quote = QuoteResponse(
                    quote_id=quote_result["quote_id"],
                    customer_id=quote_result["customer_id"],
                    vehicle_info=quote_result["vehicle"],
                    coverage_details={
                        "level": quote_result["coverage"]["level"],
                        "product": quote_result["coverage"]["product"]["name"],
                        "liability_limit": quote_result["coverage"]["liability_limit"],
                        "collision": quote_result["coverage"]["collision"],
                        "comprehensive": quote_result["coverage"]["comprehensive"],
                        "additional_coverage": quote_result["coverage"]["additional_coverage"],
                        "reasoning": quote_result["coverage"]["reasoning"]
                    },
                    premium=quote_result["premium"]["amount"],
                    discounts=quote_result["premium"]["breakdown"]["discounts"],
                    total_premium=quote_result["premium"]["breakdown"]["final_amount"],
                    valid_until=quote_result["valid_until"]
                )
            except Exception as e:
                print(f"WARNING - Failed to transform quote: {e}")
                # Continue without transformed quote

        return ChatResponse(
            response=assistant_response,
            extracted_info=vehicle_info if vehicle_info else None,
            quote=transformed_quote,
            agent_traces=get_traces(),
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions (like Bedrock unavailable)
        raise
    except Exception as e:
        print(f"Error processing chat: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error processing chat request: {str(e)}"
        )
    finally:
        disable_tracing()


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
