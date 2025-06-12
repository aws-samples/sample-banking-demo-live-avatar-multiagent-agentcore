"""
Enhanced Auto Insurance Quote Multi-Agent System

This module implements a multi-agent system for processing car insurance quotes
using LangGraph with MCP integration and fallback mechanisms. The system consists 
of six specialized agents:

1. Customer Information Agent: Retrieves and analyzes customer information
2. Vehicle Information Agent: Retrieves and analyzes vehicle information
3. Risk Assessment Agent: Assesses risk based on customer and vehicle information
4. Coverage Determination Agent: Determines appropriate coverage based on customer request and risk assessment
5. Pricing Agent: Calculates the final price based on all factors
6. Quote Generation Agent: Generates the final quote with all details

Enhanced Features:
- MCP server integration with automatic fallback to local data
- Comprehensive logging and tracing
- Error handling and recovery mechanisms
- Performance monitoring and health checks
"""

import json
import os
import logging
from typing import Dict, Optional, TypedDict, Any
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Fix the import - use ChatBedrock for Claude v3 models
from langchain_aws import ChatBedrock
from langgraph.graph import StateGraph, END

# Import enhanced modules
from tracing import trace_agent, trace_data_access, enable_tracing, get_traces
from data_access import data_access

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("backend.agent_system")

# Enable tracing by default
enable_tracing()

# Initialize Bedrock client
bedrock_model_id = os.getenv(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-7-sonnet-20250219-v1:0"
)
bedrock = ChatBedrock(
    model_id=bedrock_model_id,
    region_name=os.getenv("AWS_REGION", "us-west-2"),
    streaming=True,
    model_kwargs={"temperature": 0.2},
)

logger.info(f"Initialized Bedrock client with model: {bedrock_model_id}")

# Check data access health on startup
health_status = data_access.health_check()
logger.info(f"Data access health status: {health_status}")


# Define the enhanced state schema
class QuoteState(TypedDict):
    customer_id: str
    vehicle_info: Optional[Dict]
    customer_info: Optional[Dict]
    customer_credit: Optional[Dict]
    customer_policies: Optional[list]
    risk_assessment: Optional[Dict]
    coverage_recommendation: Optional[Dict]
    price_calculation: Optional[Dict]
    final_quote: Optional[Dict]
    processing_metadata: Optional[Dict]  # For tracking processing details


# Enhanced Agent 1: Customer Information Agent
@trace_agent("customer_info_agent")
def customer_information_agent(state: QuoteState) -> QuoteState:
    """Enhanced customer information retrieval with MCP integration and fallback"""
    customer_id = state["customer_id"]
    start_time = datetime.now()
    
    logger.info(f"Starting customer information retrieval for customer: {customer_id}")
    
    try:
        # Get comprehensive customer information
        customer_info = data_access.get_customer_info(customer_id)
        logger.info(f"Retrieved customer info for {customer_id}: {customer_info.get('name', 'Unknown')}")
        
        # Get customer credit information
        try:
            customer_credit = data_access.get_customer_credit(customer_id)
            logger.info(f"Retrieved credit info for {customer_id}: Score {customer_credit.get('credit_score', 'Unknown')}")
        except Exception as e:
            logger.warning(f"Could not retrieve credit info for {customer_id}: {str(e)}")
            customer_credit = {"credit_score": 650, "credit_tier": "fair"}  # Default values
        
        # Get existing customer policies
        try:
            customer_policies = data_access.get_customer_policies(customer_id)
            logger.info(f"Retrieved {len(customer_policies)} existing policies for {customer_id}")
        except Exception as e:
            logger.warning(f"Could not retrieve policies for {customer_id}: {str(e)}")
            customer_policies = []
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Update processing metadata
        processing_metadata = state.get("processing_metadata", {})
        processing_metadata["customer_info_processing_time"] = processing_time
        processing_metadata["customer_info_source"] = "mcp" if data_access.mcp_client else "local"
        
        logger.info(f"Customer information agent completed in {processing_time:.2f}s")
        
        return {
            **state,
            "customer_info": customer_info,
            "customer_credit": customer_credit,
            "customer_policies": customer_policies,
            "processing_metadata": processing_metadata
        }
        
    except Exception as e:
        logger.error(f"Customer information agent failed for {customer_id}: {str(e)}")
        trace_data_access("customer_info_error", {"customer_id": customer_id, "error": str(e)}, None)
        raise ValueError(f"Failed to retrieve customer information: {str(e)}")


# Enhanced Agent 2: Vehicle Information Agent
@trace_agent("vehicle_info_agent")
def vehicle_information_agent(state: QuoteState) -> QuoteState:
    """Enhanced vehicle information retrieval with MCP integration and fallback"""
    vehicle_info = state.get("vehicle_info", {})
    start_time = datetime.now()
    
    if not vehicle_info:
        logger.error("No vehicle information provided in state")
        raise ValueError("Vehicle information not provided")
    
    try:
        make = vehicle_info.get("make")
        model = vehicle_info.get("model")
        year = vehicle_info.get("year")
        
        if not all([make, model, year]):
            raise ValueError("Missing required vehicle information (make, model, or year)")
        
        logger.info(f"Starting vehicle information retrieval for: {year} {make} {model}")
        
        # Get comprehensive vehicle information
        detailed_vehicle_info = data_access.get_vehicle_info(make, model, year)
        logger.info(f"Retrieved vehicle info: {detailed_vehicle_info.get('value', 'Unknown')} value")
        
        # Get safety rating
        try:
            safety_info = data_access.get_vehicle_safety_rating(make, model, year)
            logger.info(f"Retrieved safety rating: {safety_info.get('safety_rating', 'Unknown')}")
            detailed_vehicle_info["safety_info"] = safety_info
        except Exception as e:
            logger.warning(f"Could not retrieve safety rating: {str(e)}")
            detailed_vehicle_info["safety_info"] = {"safety_rating": 4, "safety_features": []}
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Update processing metadata
        processing_metadata = state.get("processing_metadata", {})
        processing_metadata["vehicle_info_processing_time"] = processing_time
        processing_metadata["vehicle_info_source"] = "mcp" if data_access.mcp_client else "local"
        
        logger.info(f"Vehicle information agent completed in {processing_time:.2f}s")
        
        return {
            **state,
            "vehicle_info": detailed_vehicle_info,
            "processing_metadata": processing_metadata
        }
        
    except Exception as e:
        logger.error(f"Vehicle information agent failed: {str(e)}")
        trace_data_access("vehicle_info_error", 
                         {"vehicle": f"{year} {make} {model}", "error": str(e)}, 
                         None)
        raise ValueError(f"Failed to retrieve vehicle information: {str(e)}")


# Enhanced Agent 3: Risk Assessment Agent
@trace_agent("risk_assessment_agent")
def risk_assessment_agent(state: QuoteState) -> QuoteState:
    """Enhanced risk assessment with MCP integration and fallback"""
    start_time = datetime.now()
    
    try:
        customer_info = state.get("customer_info")
        customer_credit = state.get("customer_credit")
        vehicle_info = state.get("vehicle_info")
        
        if not all([customer_info, vehicle_info]):
            raise ValueError("Missing required customer or vehicle information")
        
        logger.info(f"Starting risk assessment for customer {customer_info.get('id')} and vehicle {vehicle_info.get('make')} {vehicle_info.get('model')}")
        
        # Get comprehensive risk factors
        risk_factors = data_access.get_risk_factors(
            customer_info["id"],
            vehicle_info
        )
        
        # Enrich risk assessment with credit information
        if customer_credit:
            credit_score = customer_credit.get("credit_score", 650)
            if credit_score < 600:
                risk_factors["credit_risk"] = "high"
                risk_factors["credit_factor"] = 1.3
            elif credit_score < 700:
                risk_factors["credit_risk"] = "moderate"
                risk_factors["credit_factor"] = 1.1
            else:
                risk_factors["credit_risk"] = "low"
                risk_factors["credit_factor"] = 1.0
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Update processing metadata
        processing_metadata = state.get("processing_metadata", {})
        processing_metadata["risk_assessment_processing_time"] = processing_time
        processing_metadata["risk_assessment_source"] = "mcp" if data_access.mcp_client else "local"
        
        logger.info(f"Risk assessment completed in {processing_time:.2f}s with overall risk: {risk_factors.get('overall_risk', 'Unknown')}")
        
        return {
            **state,
            "risk_assessment": risk_factors,
            "processing_metadata": processing_metadata
        }
        
    except Exception as e:
        logger.error(f"Risk assessment agent failed: {str(e)}")
        trace_data_access("risk_assessment_error", 
                         {"customer_id": customer_info.get("id"), "error": str(e)}, 
                         None)
        raise ValueError(f"Failed to complete risk assessment: {str(e)}")


# Enhanced Agent 4: Coverage Determination Agent
@trace_agent("coverage_determination_agent")
def coverage_determination_agent(state: QuoteState) -> QuoteState:
    """Enhanced coverage determination with MCP integration and fallback"""
    start_time = datetime.now()
    
    try:
        risk_assessment = state.get("risk_assessment")
        vehicle_info = state.get("vehicle_info")
        customer_info = state.get("customer_info")
        
        if not all([risk_assessment, vehicle_info, customer_info]):
            raise ValueError("Missing required information for coverage determination")
        
        logger.info(f"Starting coverage determination for customer {customer_info.get('id')}")
        
        # Get available insurance products
        products = data_access.get_insurance_products()
        
        # Select appropriate coverage based on risk and vehicle value
        vehicle_value = vehicle_info.get("value", 25000)
        overall_risk = risk_assessment.get("overall_risk", "moderate")
        
        if vehicle_value > 50000 or overall_risk == "high":
            recommended_product = next(p for p in products if p["id"] == "premium-auto")
            reasoning = f"Premium coverage recommended due to high vehicle value (${vehicle_value:,}) and/or high risk assessment"
        elif vehicle_value > 25000 or overall_risk == "moderate":
            recommended_product = next(p for p in products if p["id"] == "standard-auto")
            reasoning = f"Standard coverage recommended based on moderate vehicle value (${vehicle_value:,}) and risk assessment"
        else:
            recommended_product = next(p for p in products if p["id"] == "basic-auto")
            reasoning = f"Basic coverage recommended based on vehicle value (${vehicle_value:,}) and risk assessment"
        
        # Create coverage recommendation
        coverage_recommendation = {
            "recommended_product": recommended_product,
            "reasoning": reasoning,
            "alternative_options": [
                p for p in products if p["id"] != recommended_product["id"]
            ]
        }
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Update processing metadata
        processing_metadata = state.get("processing_metadata", {})
        processing_metadata["coverage_determination_processing_time"] = processing_time
        
        logger.info(f"Coverage determination completed in {processing_time:.2f}s with recommendation: {recommended_product['id']}")
        
        return {
            **state,
            "coverage_recommendation": coverage_recommendation,
            "processing_metadata": processing_metadata
        }
        
    except Exception as e:
        logger.error(f"Coverage determination agent failed: {str(e)}")
        trace_data_access("coverage_determination_error", 
                         {"customer_id": customer_info.get("id"), "error": str(e)}, 
                         None)
        raise ValueError(f"Failed to determine coverage: {str(e)}")


# Enhanced Agent 5: Pricing Agent
@trace_agent("pricing_agent")
def pricing_agent(state: QuoteState) -> QuoteState:
    """Enhanced pricing calculation with MCP integration and fallback"""
    start_time = datetime.now()
    
    try:
        coverage_recommendation = state.get("coverage_recommendation")
        risk_assessment = state.get("risk_assessment")
        customer_info = state.get("customer_info")
        vehicle_info = state.get("vehicle_info")
        
        if not all([coverage_recommendation, risk_assessment, customer_info, vehicle_info]):
            raise ValueError("Missing required information for price calculation")
        
        logger.info(f"Starting price calculation for customer {customer_info.get('id')}")
        
        # Get pricing rules
        pricing_rules = data_access.get_pricing_rules()
        
        # Calculate base premium
        recommended_product = coverage_recommendation["recommended_product"]
        base_premium = recommended_product["base_premium"]
        
        # Apply risk factors
        risk_multiplier = (
            risk_assessment.get("age_factor", 1.0) *
            risk_assessment.get("history_factor", 1.0) *
            risk_assessment.get("credit_factor", 1.0)
        )
        
        # Apply vehicle factors
        vehicle_value = vehicle_info.get("value", 25000)
        vehicle_factor = 1.0
        if vehicle_value > 50000:
            vehicle_factor = 1.3
        elif vehicle_value > 25000:
            vehicle_factor = 1.1
        
        # Calculate final premium
        final_premium = base_premium * risk_multiplier * vehicle_factor
        
        # Check for eligible discounts
        discounts = []
        if len(state.get("customer_policies", [])) > 0:
            discounts.append({"name": "multi-policy", "percentage": 0.10})
        if not risk_assessment.get("accidents", 0):
            discounts.append({"name": "safe-driver", "percentage": 0.15})
        
        # Apply discounts
        for discount in discounts:
            final_premium *= (1 - discount["percentage"])
        
        # Create price calculation result
        price_calculation = {
            "base_premium": base_premium,
            "risk_multiplier": risk_multiplier,
            "vehicle_factor": vehicle_factor,
            "discounts": discounts,
            "final_premium": round(final_premium, 2)
        }
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Update processing metadata
        processing_metadata = state.get("processing_metadata", {})
        processing_metadata["pricing_processing_time"] = processing_time
        
        logger.info(f"Price calculation completed in {processing_time:.2f}s with premium: ${price_calculation['final_premium']:,.2f}")
        
        return {
            **state,
            "price_calculation": price_calculation,
            "processing_metadata": processing_metadata
        }
        
    except Exception as e:
        logger.error(f"Pricing agent failed: {str(e)}")
        trace_data_access("pricing_error", 
                         {"customer_id": customer_info.get("id"), "error": str(e)}, 
                         None)
        raise ValueError(f"Failed to calculate price: {str(e)}")


# Enhanced Agent 6: Quote Generation Agent
@trace_agent("quote_generation_agent")
def quote_generation_agent(state: QuoteState) -> QuoteState:
    """Enhanced quote generation with MCP integration and fallback"""
    start_time = datetime.now()
    
    try:
        required_fields = [
            "customer_info",
            "vehicle_info",
            "risk_assessment",
            "coverage_recommendation",
            "price_calculation"
        ]
        
        missing_fields = [field for field in required_fields if not state.get(field)]
        if missing_fields:
            raise ValueError(f"Missing required fields for quote generation: {', '.join(missing_fields)}")
        
        customer_info = state["customer_info"]
        logger.info(f"Generating final quote for customer {customer_info.get('id')}")
        
        # Create the final quote
        final_quote = {
            "quote_id": f"Q{datetime.now().strftime('%Y%m%d%H%M%S')}",
            "customer": {
                "id": customer_info["id"],
                "name": customer_info["name"],
                "email": customer_info["email"]
            },
            "vehicle": {
                "make": state["vehicle_info"]["make"],
                "model": state["vehicle_info"]["model"],
                "year": state["vehicle_info"]["year"],
                "value": state["vehicle_info"]["value"]
            },
            "coverage": {
                "product": state["coverage_recommendation"]["recommended_product"],
                "reasoning": state["coverage_recommendation"]["reasoning"]
            },
            "premium": {
                "amount": state["price_calculation"]["final_premium"],
                "breakdown": {
                    "base_premium": state["price_calculation"]["base_premium"],
                    "risk_multiplier": state["price_calculation"]["risk_multiplier"],
                    "vehicle_factor": state["price_calculation"]["vehicle_factor"],
                    "discounts": state["price_calculation"]["discounts"]
                }
            },
            "risk_factors": state["risk_assessment"],
            "valid_until": (datetime.now().replace(hour=23, minute=59, second=59) + 
                          timedelta(days=30)).isoformat(),
            "generated_at": datetime.now().isoformat()
        }
        
        # Save the quote
        try:
            saved_quote = data_access.save_quote(final_quote)
            final_quote["saved_quote_id"] = saved_quote.get("quote_id")
            logger.info(f"Quote saved with ID: {final_quote['saved_quote_id']}")
        except Exception as e:
            logger.warning(f"Failed to save quote: {str(e)}")
        
        # Calculate processing time
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # Update processing metadata
        processing_metadata = state.get("processing_metadata", {})
        processing_metadata["quote_generation_processing_time"] = processing_time
        processing_metadata["total_processing_time"] = sum(
            float(v) for k, v in processing_metadata.items() 
            if k.endswith("_processing_time")
        )
        
        logger.info(f"Quote generation completed in {processing_time:.2f}s")
        logger.info(f"Total processing time: {processing_metadata['total_processing_time']:.2f}s")
        
        return {
            **state,
            "final_quote": final_quote,
            "processing_metadata": processing_metadata
        }
        
    except Exception as e:
        logger.error(f"Quote generation agent failed: {str(e)}")
        trace_data_access("quote_generation_error", 
                         {"customer_id": state.get("customer_info", {}).get("id"), "error": str(e)}, 
                         None)
        raise ValueError(f"Failed to generate quote: {str(e)}")


# Create the enhanced workflow graph
def create_quote_workflow() -> StateGraph:
    """Create the enhanced quote generation workflow with error handling"""
    
    # Create the workflow graph
    workflow = StateGraph(QuoteState)
    
    # Add the agents as nodes with unique names
    workflow.add_node("customer_info_node", customer_information_agent)
    workflow.add_node("vehicle_info_node", vehicle_information_agent)
    workflow.add_node("risk_assessment_node", risk_assessment_agent)
    workflow.add_node("coverage_determination_node", coverage_determination_agent)
    workflow.add_node("pricing_node", pricing_agent)
    workflow.add_node("quote_generation_node", quote_generation_agent)
    
    # Add edges to define the workflow (sequential to avoid concurrent updates)
    workflow.add_edge("customer_info_node", "vehicle_info_node")
    workflow.add_edge("vehicle_info_node", "risk_assessment_node")
    workflow.add_edge("risk_assessment_node", "coverage_determination_node")
    workflow.add_edge("coverage_determination_node", "pricing_node")
    workflow.add_edge("pricing_node", "quote_generation_node")
    workflow.add_edge("quote_generation_node", END)
    
    # Set single entry point
    workflow.set_entry_point("customer_info_node")
    
    logger.info("Created enhanced quote workflow with validation and error handling")
    
    return workflow.compile()


# Main workflow execution function
def process_quote_request(customer_id: str, vehicle_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a complete quote request using the enhanced multi-agent workflow
    
    Args:
        customer_id: The customer identifier
        vehicle_info: Dictionary containing vehicle information (make, model, year)
    
    Returns:
        Dictionary containing the complete quote and processing metadata
    """
    start_time = datetime.now()
    logger.info(f"Starting quote processing for customer {customer_id}")
    
    try:
        # Create the workflow
        workflow = create_quote_workflow()
        
        # Initialize the state
        initial_state = QuoteState(
            customer_id=customer_id,
            vehicle_info=vehicle_info,
            customer_info=None,
            customer_credit=None,
            customer_policies=None,
            risk_assessment=None,
            coverage_recommendation=None,
            price_calculation=None,
            final_quote=None,
            processing_metadata={"workflow_start_time": start_time.isoformat()}
        )
        
        # Execute the workflow
        final_state = workflow.invoke(initial_state)
        
        # Calculate total processing time
        total_time = (datetime.now() - start_time).total_seconds()
        final_state["processing_metadata"]["total_workflow_time"] = total_time
        
        logger.info(f"Quote processing completed successfully in {total_time:.2f}s")
        logger.info(f"Generated quote ID: {final_state['final_quote']['quote_id']}")
        
        return final_state
        
    except Exception as e:
        error_time = (datetime.now() - start_time).total_seconds()
        logger.error(f"Quote processing failed after {error_time:.2f}s: {str(e)}")
        
        # Return error state
        return {
            "error": str(e),
            "customer_id": customer_id,
            "vehicle_info": vehicle_info,
            "processing_metadata": {
                "workflow_start_time": start_time.isoformat(),
                "error_time": error_time,
                "failed": True
            }
        }


# Health check function
def get_system_health() -> Dict[str, Any]:
    """Get comprehensive system health information"""
    try:
        data_health = data_access.health_check()
        traces = get_traces()
        
        return {
            "status": "healthy" if data_health.get("mcp_healthy", False) or data_health.get("local_data_loaded", False) else "degraded",
            "data_access": data_health,
            "tracing": {
                "enabled": True,
                "trace_count": len(traces)
            },
            "bedrock": {
                "model": bedrock_model_id,
                "region": os.getenv("AWS_REGION", "us-west-2")
            },
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }


# Cleanup function
def cleanup():
    """Clean up resources"""
    try:
        data_access.close()
        logger.info("Agent system cleanup completed")
    except Exception as e:
        logger.error(f"Cleanup failed: {str(e)}")


# Example usage and testing
if __name__ == "__main__":
    # Test the enhanced system
    test_customer_id = "cust-001"
    test_vehicle = {
        "make": "Toyota",
        "model": "Camry",
        "year": 2024
    }
    
    logger.info("Starting system test...")
    
    # Check system health
    health = get_system_health()
    logger.info(f"System health: {health['status']}")
    
    # Process a test quote
    try:
        result = process_quote_request(test_customer_id, test_vehicle)
        
        if "error" in result:
            logger.error(f"Test failed: {result['error']}")
        else:
            logger.info("Test completed successfully!")
            logger.info(f"Quote ID: {result['final_quote']['quote_id']}")
            logger.info(f"Premium: ${result['final_quote']['premium']['amount']:,.2f}")
            
    except Exception as e:
        logger.error(f"Test execution failed: {str(e)}")
    
    finally:
        cleanup()
