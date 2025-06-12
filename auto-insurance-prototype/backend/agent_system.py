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
import uuid
import logging
from typing import Dict, Optional, TypedDict, Any, List, Annotated
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Modern LangGraph imports
from langchain_aws import ChatBedrock
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

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
bedrock_client = ChatBedrock(
    model_id="anthropic.claude-3-sonnet-20240229-v1:0",
    region_name=os.getenv("AWS_REGION", "us-west-2")
)
logger.info(f"Initialized Bedrock client with model: {bedrock_client.model_id}")

# Define state using modern LangGraph patterns
class QuoteState(TypedDict):
    customer_id: str
    vehicle_info: Dict[str, Any]
    customer_info: Optional[Dict[str, Any]]
    risk_assessment: Optional[Dict[str, Any]]
    coverage: Optional[Dict[str, Any]]
    pricing: Optional[Dict[str, Any]]
    final_quote: Optional[Dict[str, Any]]
    error: Optional[str]
    processing_step: str

def process_quote_request(customer_id: str, vehicle_info: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a quote request through the enhanced multi-agent system.
    
    Args:
        customer_id (str): The customer's ID
        vehicle_info (dict): Vehicle information including make, model, year
        
    Returns:
        dict: The final quote or error information
    """
    logger.info(f"Starting quote processing for customer {customer_id}")
    start_time = datetime.now()
    
    try:
        # Check system health first
        health_status = data_access.health_check()
        logger.info(f"Data access health status: {health_status}")
        
        # Create the workflow
        workflow = create_quote_workflow()
        
        # Initialize state
        initial_state = QuoteState(
            customer_id=customer_id,
            vehicle_info=vehicle_info,
            customer_info=None,
            risk_assessment=None,
            coverage=None,
            pricing=None,
            final_quote=None,
            error=None,
            processing_step="start"
        )

        # Execute workflow
        final_state = workflow.invoke(initial_state)

        # Check for errors
        if final_state.get("error"):
            logger.error(f"Quote processing failed: {final_state['error']}")
            return {
                "error": final_state["error"],
                "customer_id": customer_id,
                "vehicle_info": vehicle_info,
                "processing_metadata": {
                    "duration": str(datetime.now() - start_time),
                    "completed_steps": final_state.get("processing_step", "unknown")
                }
            }

        # Return successful result
        logger.info(f"Quote processing completed successfully in {datetime.now() - start_time}")
        return {
            "final_quote": final_state["final_quote"],
            "processing_metadata": {
                "duration": str(datetime.now() - start_time),
                "completed_steps": "all"
            }
        }

    except Exception as e:
        duration = datetime.now() - start_time
        logger.error(f"Quote processing failed after {duration}: {str(e)}")
        return {
            "error": str(e),
            "customer_id": customer_id,
            "vehicle_info": vehicle_info,
            "processing_metadata": {
                "duration": str(duration),
                "error_type": type(e).__name__
            }
        }

def create_quote_workflow() -> StateGraph:
    """Create the quote processing workflow using modern LangGraph patterns"""
    
    # Define agent functions
    @trace_agent("customer_info_agent")
    def customer_info_agent(state: QuoteState) -> QuoteState:
        """Retrieve and analyze customer information"""
        try:
            logger.info(f"Processing customer info for {state['customer_id']}")
            customer_info = data_access.get_customer_info(state["customer_id"])
            
            return {
                **state,
                "customer_info": customer_info,
                "processing_step": "customer_info_complete"
            }
        except Exception as e:
            logger.error(f"Customer info agent failed: {e}")
            return {
                **state,
                "error": f"Customer info error: {str(e)}",
                "processing_step": "customer_info_failed"
            }

    @trace_agent("vehicle_info_agent")
    def vehicle_info_agent(state: QuoteState) -> QuoteState:
        """Analyze and validate vehicle information"""
        try:
            logger.info(f"Processing vehicle info: {state['vehicle_info']}")
            vehicle_data = data_access.get_vehicle_info(
                state["vehicle_info"]["make"],
                state["vehicle_info"]["model"],
                state["vehicle_info"]["year"]
            )
            
            # Merge the enriched vehicle data
            enriched_vehicle_info = {**state["vehicle_info"], **vehicle_data}
            
            return {
                **state,
                "vehicle_info": enriched_vehicle_info,
                "processing_step": "vehicle_info_complete"
            }
        except Exception as e:
            logger.error(f"Vehicle info agent failed: {e}")
            return {
                **state,
                "error": f"Vehicle info error: {str(e)}",
                "processing_step": "vehicle_info_failed"
            }

    @trace_agent("risk_assessment_agent")
    def risk_assessment_agent(state: QuoteState) -> QuoteState:
        """Assess risk based on customer and vehicle information"""
        try:
            logger.info("Processing risk assessment")
            pricing_rules = data_access.get_pricing_rules()
            risk_assessment = assess_risk(
                state["customer_info"],
                state["vehicle_info"],
                pricing_rules
            )
            
            return {
                **state,
                "risk_assessment": risk_assessment,
                "processing_step": "risk_assessment_complete"
            }
        except Exception as e:
            logger.error(f"Risk assessment agent failed: {e}")
            return {
                **state,
                "error": f"Risk assessment error: {str(e)}",
                "processing_step": "risk_assessment_failed"
            }

    @trace_agent("coverage_agent")
    def coverage_agent(state: QuoteState) -> QuoteState:
        """Determine appropriate coverage"""
        try:
            logger.info("Processing coverage determination")
            products = data_access.get_insurance_products()
            coverage = determine_coverage(
                state["customer_info"],
                state["vehicle_info"],
                state["risk_assessment"],
                products
            )
            
            return {
                **state,
                "coverage": coverage,
                "processing_step": "coverage_complete"
            }
        except Exception as e:
            logger.error(f"Coverage agent failed: {e}")
            return {
                **state,
                "error": f"Coverage determination error: {str(e)}",
                "processing_step": "coverage_failed"
            }

    @trace_agent("pricing_agent")
    def pricing_agent(state: QuoteState) -> QuoteState:
        """Calculate final pricing"""
        try:
            logger.info("Processing pricing calculation")
            pricing_rules = data_access.get_pricing_rules()
            pricing = calculate_premium(
                state["customer_info"],
                state["vehicle_info"],
                state["risk_assessment"],
                state["coverage"],
                pricing_rules
            )
            
            return {
                **state,
                "pricing": pricing,
                "processing_step": "pricing_complete"
            }
        except Exception as e:
            logger.error(f"Pricing agent failed: {e}")
            return {
                **state,
                "error": f"Pricing calculation error: {str(e)}",
                "processing_step": "pricing_failed"
            }

    @trace_agent("quote_generation_agent")
    def quote_generation_agent(state: QuoteState) -> QuoteState:
        """Generate final quote"""
        try:
            logger.info("Generating final quote")
            quote = {
                "quote_id": str(uuid.uuid4()),
                "customer_id": state["customer_id"],
                "vehicle": state["vehicle_info"],
                "coverage": state["coverage"],
                "risk_factors": state["risk_assessment"],
                "premium": state["pricing"],
                "valid_until": (datetime.now() + timedelta(days=30)).isoformat(),
                "generated_at": datetime.now().isoformat()
            }
            
            return {
                **state,
                "final_quote": quote,
                "processing_step": "quote_generation_complete"
            }
        except Exception as e:
            logger.error(f"Quote generation agent failed: {e}")
            return {
                **state,
                "error": f"Quote generation error: {str(e)}",
                "processing_step": "quote_generation_failed"
            }

    # Define conditional logic
    def should_continue(state: QuoteState) -> str:
        """Determine next step based on current state"""
        if state.get("error"):
            return END
        
        step = state.get("processing_step", "start")
        
        if step == "start":
            return "get_customer_info"
        elif step == "customer_info_complete":
            return "get_vehicle_info"
        elif step == "vehicle_info_complete":
            return "assess_risk"
        elif step == "risk_assessment_complete":
            return "determine_coverage"
        elif step == "coverage_complete":
            return "calculate_pricing"
        elif step == "pricing_complete":
            return "generate_quote"
        elif step == "quote_generation_complete":
            return END
        else:
            return END

    # Create workflow graph using modern LangGraph
    workflow = StateGraph(QuoteState)

    # Add nodes with unique names
    workflow.add_node("get_customer_info", customer_info_agent)
    workflow.add_node("get_vehicle_info", vehicle_info_agent)
    workflow.add_node("assess_risk", risk_assessment_agent)
    workflow.add_node("determine_coverage", coverage_agent)
    workflow.add_node("calculate_pricing", pricing_agent)
    workflow.add_node("generate_quote", quote_generation_agent)

    # Add conditional edges using modern pattern
    workflow.add_conditional_edges(
        START,
        should_continue,
        {
            "get_customer_info": "get_customer_info",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "get_customer_info",
        should_continue,
        {
            "get_vehicle_info": "get_vehicle_info",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "get_vehicle_info",
        should_continue,
        {
            "assess_risk": "assess_risk",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "assess_risk",
        should_continue,
        {
            "determine_coverage": "determine_coverage",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "determine_coverage",
        should_continue,
        {
            "calculate_pricing": "calculate_pricing",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "calculate_pricing",
        should_continue,
        {
            "generate_quote": "generate_quote",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "generate_quote",
        should_continue,
        {
            END: END
        }
    )

    # Compile workflow
    return workflow.compile()

def assess_risk(customer_info: Dict[str, Any], vehicle_info: Dict[str, Any], pricing_rules: Dict[str, Any]) -> Dict[str, Any]:
    """Assess risk based on customer and vehicle information"""
    
    # Calculate age from date of birth
    from datetime import datetime
    dob_str = customer_info["dob"]
    dob = datetime.strptime(dob_str, "%Y-%m-%d")
    today = datetime.now()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    
    # Calculate age risk factor based on actual pricing rules structure
    base_factors = pricing_rules.get("base_factors", {})
    age_factors = base_factors.get("age", {})
    
    if age < 20:
        age_risk = "high"
        age_factor = age_factors.get("16-19", 1.8)
    elif age < 25:
        age_risk = "high"
        age_factor = age_factors.get("20-24", 1.4)
    elif age < 30:
        age_risk = "moderate"
        age_factor = age_factors.get("25-29", 1.2)
    elif age < 40:
        age_risk = "low"
        age_factor = age_factors.get("30-39", 1.0)
    elif age < 50:
        age_risk = "low"
        age_factor = age_factors.get("40-49", 0.9)
    elif age < 60:
        age_risk = "low"
        age_factor = age_factors.get("50-59", 0.85)
    elif age < 70:
        age_risk = "moderate"
        age_factor = age_factors.get("60-69", 0.9)
    else:
        age_risk = "high"
        age_factor = age_factors.get("70+", 1.1)

    # Driving history risk - adjust for different data structure
    driving_history = customer_info["driving_history"]
    accidents = len(driving_history.get("accidents", []))
    violations = len(driving_history.get("violations", []))

    # Determine history risk and factor
    accident_factors = base_factors.get("accident_history", {})
    if accidents > 0:
        history_risk = "high"
        history_factor = accident_factors.get("at_fault_accident_past_3_years", 1.4)
    elif violations > 0:
        history_risk = "moderate"
        history_factor = 1.2  # Default for violations
    else:
        history_risk = "low"
        history_factor = accident_factors.get("no_accidents", 1.0)

    # Credit score risk - get from credit report if available
    try:
        customer_credit = data_access.get_customer_credit(customer_info["id"])
        credit_score = customer_credit.get("credit_score", 700)  # Default to good credit
    except:
        credit_score = 700  # Default fallback
        
    # Map credit score to risk factor
    credit_factors = base_factors.get("credit_score", {})
    if credit_score >= 800:
        credit_risk = "low"
        credit_factor = credit_factors.get("800-850", 0.8)
    elif credit_score >= 740:
        credit_risk = "low"
        credit_factor = credit_factors.get("740-799", 0.9)
    elif credit_score >= 670:
        credit_risk = "moderate"
        credit_factor = credit_factors.get("670-739", 1.0)
    elif credit_score >= 580:
        credit_risk = "moderate"
        credit_factor = credit_factors.get("580-669", 1.15)
    else:
        credit_risk = "high"
        credit_factor = credit_factors.get("300-579", 1.3)

    # Vehicle risk factors
    vehicle_value = vehicle_info["value"]
    vehicle_factors = base_factors.get("vehicle", {})
    
    # Simple vehicle value factor
    if vehicle_value < 20000:
        value_factor = 0.9
    elif vehicle_value < 40000:
        value_factor = 1.0
    elif vehicle_value < 70000:
        value_factor = 1.1
    else:
        value_factor = 1.2

    # Safety rating discount
    safety_rating = vehicle_info.get("safety_rating", 3)
    safety_discount = 0.05 if safety_rating >= 4.5 else 0

    # Theft rating surcharge - handle string values
    theft_rating = vehicle_info.get("theft_rating", "low")
    theft_surcharge = 0
    if isinstance(theft_rating, str):
        if theft_rating.lower() in ["high", "severe"]:
            theft_surcharge = 0.1
        elif theft_rating.lower() == "moderate":
            theft_surcharge = 0.05
    elif theft_rating >= 3.5:
        theft_surcharge = 0.1

    # Determine overall risk
    risk_scores = {
        "low": 1,
        "moderate": 2,
        "high": 3
    }
    
    avg_risk_score = (
        risk_scores[age_risk] +
        risk_scores[history_risk] +
        risk_scores[credit_risk]
    ) / 3

    if avg_risk_score >= 2.5:
        overall_risk = "high"
    elif avg_risk_score >= 1.5:
        overall_risk = "moderate"
    else:
        overall_risk = "low"

    return {
        "overall_risk": overall_risk,
        "age": age,
        "age_risk": age_risk,
        "age_factor": age_factor,
        "accidents": accidents,
        "violations": violations,
        "history_risk": history_risk,
        "history_factor": history_factor,
        "credit_score": credit_score,
        "credit_risk": credit_risk,
        "credit_factor": credit_factor,
        "value_factor": value_factor,
        "safety_discount": safety_discount,
        "theft_surcharge": theft_surcharge
    }

def determine_coverage(
    customer_info: Dict[str, Any],
    vehicle_info: Dict[str, Any],
    risk_assessment: Dict[str, Any],
    products: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Determine appropriate coverage based on risk assessment"""
    
    # Get available products - handle both list and dict formats
    if isinstance(products, dict):
        available_products = products.get("products", [])
    else:
        available_products = products
    
    # Map risk levels to product IDs
    risk_product_map = {
        "high": "basic-auto",
        "moderate": "standard-auto",
        "low": "premium-auto"
    }
    
    # Get base product based on risk level
    risk_level = risk_assessment["overall_risk"]
    recommended_product_id = risk_product_map.get(risk_level, "standard-auto")
    
    # Find the recommended product
    recommended_product = next(
        (p for p in available_products if p["id"] == recommended_product_id),
        next((p for p in available_products if p["id"] == "standard-auto"), available_products[0] if available_products else None)  # Default fallback
    )
    
    if not recommended_product:
        # Create a basic fallback product
        recommended_product = {
            "id": "standard-auto",
            "name": "Standard Auto Insurance",
            "base_premium": 1000.0,
            "coverage_options": {
                "liability": [100000, 300000, 500000],
                "collision": True,
                "comprehensive": True
            }
        }

    # Adjust coverage based on vehicle value
    vehicle_value = vehicle_info["value"]
    if vehicle_value > 50000:
        # Find premium product
        coverage_level = "premium"
        product = next(
            (p for p in available_products if p["id"] == "premium-auto"),
            recommended_product  # Fallback to recommended if premium not found
        )
        reasoning = "High-value vehicle requires premium coverage"
    elif vehicle_value > 30000:
        coverage_level = "standard"
        product = next(
            (p for p in available_products if p["id"] == "standard-auto"),
            recommended_product  # Fallback to recommended if standard not found
        )
        reasoning = "Mid-range vehicle value suggests standard coverage"
    else:
        coverage_level = "basic"
        product = recommended_product
        reasoning = f"Vehicle value allows for basic coverage, adjusted by risk assessment (Risk Level: {risk_level})"

    # Recommend additional coverage based on risk factors
    additional_coverage = []
    
    # Theft protection for high theft risk vehicles
    if risk_assessment["theft_surcharge"] > 0:
        additional_coverage.append({
            "type": "theft_protection",
            "reason": "High theft risk for this vehicle model"
        })
    
    # Accident forgiveness for drivers with history
    if risk_assessment["history_risk"] == "high":
        additional_coverage.append({
            "type": "accident_forgiveness",
            "reason": "Previous accidents suggest benefit from forgiveness program"
        })

    # Gap insurance for newer, high-value vehicles
    if vehicle_value > 40000 and (datetime.now().year - vehicle_info["year"]) <= 3:
        additional_coverage.append({
            "type": "gap_insurance",
            "reason": "High-value, newer vehicle benefits from gap coverage"
        })

    # Determine liability limits based on risk and value
    liability_options = product.get("coverage_options", {}).get("liability", [100000, 300000, 500000])
    if risk_level == "high":
        liability_limit = min(liability_options)
    elif risk_level == "low":
        liability_limit = max(liability_options)
    else:
        # Get middle value for moderate risk
        sorted_options = sorted(liability_options)
        liability_limit = sorted_options[len(sorted_options) // 2]

    # Build final coverage details
    coverage_details = {
        "level": coverage_level,
        "product": product,
        "liability_limit": liability_limit,
        "collision": product.get("coverage_options", {}).get("collision", True),
        "comprehensive": product.get("coverage_options", {}).get("comprehensive", True),
        "additional_coverage": additional_coverage,
        "reasoning": reasoning
    }

    return coverage_details

def calculate_premium(
    customer_info: Dict[str, Any],
    vehicle_info: Dict[str, Any],
    risk_assessment: Dict[str, Any],
    coverage: Dict[str, Any],
    pricing_rules: Dict[str, Any]
) -> Dict[str, Any]:
    """Calculate the final premium"""
    
    # Get base premium from the product
    base_premium = coverage["product"]["base_premium"]
    
    # Apply risk factors
    risk_multiplier = (
        risk_assessment["age_factor"]
        * risk_assessment["history_factor"]
        * risk_assessment["credit_factor"]
    )
    
    # Apply vehicle factors
    vehicle_factor = (
        risk_assessment["value_factor"]
        * (1 - risk_assessment["safety_discount"])
        * (1 + risk_assessment["theft_surcharge"])
    )
    
    # Apply coverage factors
    coverage_factors = pricing_rules.get("coverage_factors", {})
    
    # Liability factor based on limit
    liability_factors = coverage_factors.get("liability", {})
    liability_limit = coverage["liability_limit"]
    liability_factor = liability_factors.get(str(liability_limit), 1.0)
    
    # Deductible factor (use standard if not specified)
    deductible_factors = coverage_factors.get("deductible", {})
    deductible = coverage.get("deductible", 1000)  # Default to 1000
    deductible_factor = deductible_factors.get(str(deductible), 1.0)
    
    # Calculate additional coverage costs
    additional_costs = []
    additional_coverage_costs = coverage_factors.get("additional_coverage", {})
    
    for coverage_item in coverage["additional_coverage"]:
        cost_type = coverage_item["type"]
        cost = additional_coverage_costs.get(cost_type, 0)
        if cost > 0:
            additional_costs.append({
                "type": cost_type,
                "cost": cost,
                "reason": coverage_item["reason"]
            })
    
    # Calculate discounts
    discounts = []
    
    # Multi-policy discount
    if len(customer_info.get("current_policies", [])) > 0:
        discount = 0.1  # 10% discount
        discounts.append({
            "type": "multi_policy",
            "amount": base_premium * discount,
            "percentage": discount * 100
        })
    
    # Safe driver discount
    if (risk_assessment["accidents"] == 0 and 
        risk_assessment["violations"] == 0):
        discount = 0.15  # 15% discount
        discounts.append({
            "type": "safe_driver",
            "amount": base_premium * discount,
            "percentage": discount * 100
        })
    
    # Good credit discount
    if risk_assessment["credit_risk"] == "low":
        discount = 0.1  # 10% discount
        discounts.append({
            "type": "good_credit",
            "amount": base_premium * discount,
            "percentage": discount * 100
        })
    
    # Calculate total discount amount
    total_discount = sum(d["amount"] for d in discounts)
    
    # Calculate final premium
    subtotal = base_premium * risk_multiplier * vehicle_factor * liability_factor * deductible_factor
    additional_amount = sum(item["cost"] for item in additional_costs)
    final_amount = (subtotal + additional_amount) - total_discount
    
    return {
        "amount": final_amount,
        "breakdown": {
            "base_premium": base_premium,
            "risk_multiplier": risk_multiplier,
            "vehicle_factor": vehicle_factor,
            "liability_factor": liability_factor,
            "deductible_factor": deductible_factor,
            "additional_costs": additional_costs,
            "discounts": discounts,
            "total_discount": total_discount,
            "subtotal": subtotal,
            "final_amount": final_amount
        }
    }

def get_system_health() -> Dict[str, Any]:
    """Get system health status"""
    try:
        data_health = data_access.health_check()
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "data_access": data_health,
            "bedrock_client": "initialized"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "error": str(e)
        }
