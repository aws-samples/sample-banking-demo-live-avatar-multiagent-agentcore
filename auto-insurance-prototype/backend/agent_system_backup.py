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
    "BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"
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


# Agent 2: Vehicle Information Agent
@trace_agent("vehicle_info_agent")
def vehicle_information_agent(state: QuoteState) -> QuoteState:
    """Retrieves and analyzes vehicle information"""
    vehicle_info = state.get("vehicle_info")

    # Trace data access
    trace_data_access("vehicle_info", {"vehicle_data": vehicle_info}, vehicle_info)

    if not vehicle_info:
        # If no vehicle info provided, we could look up by VIN in a real system
        # For now, just return an error
        raise ValueError("Vehicle information not provided")

    # In a real system, we might enrich the vehicle data with additional information
    # For now, we'll just pass it through

    return {"vehicle_info": vehicle_info}


# Agent 3: Risk Assessment Agent
@trace_agent("risk_assessment_agent")
def risk_assessment_agent(state: QuoteState) -> QuoteState:
    """Assesses risk based on customer and vehicle information"""
    customer_info = state.get("customer_info")
    vehicle_info = state.get("vehicle_info")

    # Trace data access
    trace_data_access("risk_assessment_input", {
        "customer_info": customer_info,
        "vehicle_info": vehicle_info
    }, None)

    if not customer_info or not vehicle_info:
        raise ValueError("Missing customer or vehicle information")

    '''
    # For a more sophisticated approach, we can use the LLM to analyze risk factors
    # Commented out unused prompt template
    # risk_assessment_prompt = ChatPromptTemplate.from_messages([
    #     SystemMessage(content="""You are an expert insurance risk assessor. Your task is to analyze customer and vehicle 
    #     information to determine insurance risk levels. Provide a detailed risk assessment with clear reasoning.
        
        Follow these guidelines:
        1. Analyze age-related risk factors (higher risk for very young and elderly drivers)
        2. Evaluate driving history (accidents and violations increase risk)
        3. Consider credit score as a predictor of claim likelihood
        4. Assess vehicle-specific risks (value, safety features, theft probability)
        5. Determine an overall risk category (low, moderate, high)
        6. Calculate specific risk factors that will be used in premium calculations
        
        Your output should be structured as a JSON object with the following format:
        {
          "overall_risk": "low|moderate|high",
          "age_risk": "low|moderate|high",
          "history_risk": "low|moderate|high", 
          "credit_risk": "low|moderate|high",
          "vehicle_risk": "low|moderate|high",
          "risk_factors": {
            "age_factor": float,
            "history_factor": float,
            "credit_factor": float,
            "value_factor": float,
            "safety_discount": float,
            "theft_surcharge": float
          },
          "reasoning": "detailed explanation of risk assessment"
        }
        """),
        HumanMessage(content=f"""
        Please assess the insurance risk for the following customer and vehicle:
        
        Customer Information:
        {json.dumps(customer_info, indent=2)}
        
        Vehicle Information:
        {json.dumps(vehicle_info, indent=2)}
        
        Pricing Rules:
        {json.dumps(pricing_rules, indent=2)}
        """)
    ])
    '''

    # In a production system, we would call the LLM here
    # response = bedrock.invoke(risk_assessment_prompt)
    # risk_assessment = json.loads(response.content)

    # For now, we'll use our rule-based approach for consistency

    # Calculate risk factors
    age = customer_info["age"]
    if age < 25:
        age_risk = "high"
        age_factor = pricing_rules["age_factors"]["under_25"]
    elif age > 60:
        age_risk = "moderate"
        age_factor = pricing_rules["age_factors"]["over_60"]
    else:
        age_risk = "low"
        age_factor = pricing_rules["age_factors"]["25_to_60"]

    # Driving history risk
    accidents = customer_info["drivingHistory"]["accidents"]
    violations = customer_info["drivingHistory"]["violations"]

    if accidents > 0 and violations > 0:
        history_risk = "high"
        history_factor = (
            pricing_rules["driving_history_factors"]["accident_multiplier"]
            * pricing_rules["driving_history_factors"]["violation_multiplier"]
        )
    elif accidents > 0:
        history_risk = "moderate"
        history_factor = pricing_rules["driving_history_factors"]["accident_multiplier"]
    elif violations > 0:
        history_risk = "moderate"
        history_factor = pricing_rules["driving_history_factors"][
            "violation_multiplier"
        ]
    else:
        history_risk = "low"
        history_factor = pricing_rules["driving_history_factors"][
            "clean_record_discount"
        ]

    # Credit score risk
    credit_score = customer_info["creditScore"]
    if credit_score >= 750:
        credit_risk = "low"
        credit_factor = pricing_rules["credit_score_factors"]["excellent"]
    elif credit_score >= 700:
        credit_risk = "low"
        credit_factor = pricing_rules["credit_score_factors"]["good"]
    elif credit_score >= 650:
        credit_risk = "moderate"
        credit_factor = pricing_rules["credit_score_factors"]["fair"]
    else:
        credit_risk = "high"
        credit_factor = pricing_rules["credit_score_factors"]["poor"]

    # Vehicle risk
    vehicle_value = vehicle_info["value"]
    if vehicle_value < 20000:
        value_factor = pricing_rules["vehicle_factors"]["value_tiers"]["under_20k"]
    elif vehicle_value < 40000:
        value_factor = pricing_rules["vehicle_factors"]["value_tiers"]["20k_to_40k"]
    elif vehicle_value < 70000:
        value_factor = pricing_rules["vehicle_factors"]["value_tiers"]["40k_to_70k"]
    else:
        value_factor = pricing_rules["vehicle_factors"]["value_tiers"]["over_70k"]

    # Safety rating discount
    safety_rating = vehicle_info["safetyRating"]
    safety_discount = 0
    if safety_rating >= 4.5:
        safety_discount = pricing_rules["vehicle_factors"]["safety_rating_discount"]

    # Theft rating surcharge
    theft_rating = vehicle_info["theftRating"]
    theft_surcharge = 0
    if theft_rating >= 3.5:
        theft_surcharge = pricing_rules["vehicle_factors"]["high_theft_surcharge"]

    # Determine overall risk (more sophisticated in a real system)
    risk_scores = {"low": 1, "moderate": 2, "high": 3}

    avg_risk_score = (
        risk_scores[age_risk] + risk_scores[history_risk] + risk_scores[credit_risk]
    ) / 3

    if avg_risk_score < 1.5:
        overall_risk = "low"
    elif avg_risk_score < 2.5:
        overall_risk = "moderate"
    else:
        overall_risk = "high"

    # Generate reasoning
    reasoning = f"""
    Risk assessment for {customer_info["name"]}:
    
    Age: {customer_info["age"]} years old - {age_risk} risk
    Driving history: {accidents} accidents, {violations} violations - {history_risk} risk
    Credit score: {credit_score} - {credit_risk} risk
    Vehicle: {vehicle_info["year"]} {vehicle_info["make"]} {vehicle_info["model"]} - Value: ${vehicle_info["value"]}
    Safety rating: {safety_rating}/5.0 - {"Qualifies for safety discount" if safety_discount > 0 else "No safety discount"}
    Theft rating: {theft_rating}/5.0 - {"High theft risk surcharge applies" if theft_surcharge > 0 else "No theft surcharge"}
    
    Overall risk assessment: {overall_risk.upper()}
    """

    # Compile risk assessment
    risk_assessment = {
        "overall_risk": overall_risk,
        "age_risk": age_risk,
        "history_risk": history_risk,
        "credit_risk": credit_risk,
        "vehicle_risk": "moderate",  # Simplified for this example
        "risk_factors": {
            "age_factor": age_factor,
            "history_factor": history_factor,
            "credit_factor": credit_factor,
            "value_factor": value_factor,
            "safety_discount": safety_discount,
            "theft_surcharge": theft_surcharge,
        },
        "reasoning": reasoning,
    }

    return {"risk_assessment": risk_assessment}


# Agent 4: Coverage Determination Agent
@trace_agent("coverage_determination_agent")
def coverage_determination_agent(state: QuoteState) -> QuoteState:
    """Determines appropriate coverage based on customer request and risk assessment"""
    risk_assessment = state.get("risk_assessment")
    vehicle_info = state.get("vehicle_info")
    customer_info = state.get("customer_info")

    # Trace data access
    trace_data_access("coverage_determination_input", {
        "risk_assessment": risk_assessment,
        "vehicle_info": vehicle_info,
        "customer_info": customer_info
    }, None)

    if not risk_assessment or not vehicle_info or not customer_info:
        raise ValueError("Missing required information for coverage determination")
    '''
    # For a more sophisticated approach, we can use the LLM to determine the best coverage
    # Commented out unused prompt template
    # coverage_prompt = ChatPromptTemplate.from_messages([
    #     SystemMessage(content="""You are an expert insurance advisor specializing in auto insurance coverage recommendations.
    #     Your task is to analyze customer information, vehicle details, and risk assessment to recommend the most appropriate 
        insurance coverage package.
        
        Follow these guidelines:
        1. Consider the customer's profile (age, driving history, etc.)
        2. Evaluate the vehicle's characteristics (value, age, safety features)
        3. Take into account the risk assessment provided
        4. Select from available insurance products (basic, standard, premium)
        5. Provide clear reasoning for your recommendation
        
        Available Products:
        - Basic: Minimum required liability coverage
        - Standard: Liability plus collision and comprehensive with $500 deductibles
        - Premium: Maximum coverage including low deductibles, uninsured motorist, roadside assistance, and rental reimbursement
        
        Your output should be structured as a JSON object with the following format:
        {
          "recommended_product": {product_object},
          "reasoning": "detailed explanation of recommendation",
          "alternative_options": [
            {
              "product": {product_object},
              "scenario": "situation where this might be preferred"
            }
          ]
        }
        """),
        HumanMessage(content=f"""
        Please recommend appropriate coverage for the following:
        
        Customer Information:
        {json.dumps(customer_info, indent=2)}
        
        Vehicle Information:
        {json.dumps(vehicle_info, indent=2)}
        
        Risk Assessment:
        {json.dumps(risk_assessment, indent=2)}
        
        Available Products:
        {json.dumps(products, indent=2)}
        """)
    ])
    '''

    # In a production system, we would call the LLM here
    # response = bedrock.invoke(coverage_prompt)
    # coverage_recommendation = json.loads(response.content)

    # For now, we'll use our rule-based approach for consistency
    vehicle_value = vehicle_info["value"]
    overall_risk = risk_assessment["overall_risk"]

    # Select product based on vehicle value and risk
    if vehicle_value > 50000 or overall_risk == "high":
        recommended_product = next(p for p in products if p["id"] == "premium")
        reasoning = f"Premium coverage recommended due to high vehicle value (${vehicle_value}) and/or high risk assessment. This provides maximum protection for a valuable asset."
    elif vehicle_value > 25000 or overall_risk == "moderate":
        recommended_product = next(p for p in products if p["id"] == "standard")
        reasoning = f"Standard coverage recommended based on moderate vehicle value (${vehicle_value}) and/or moderate risk assessment. This provides a good balance of protection and cost."
    else:
        recommended_product = next(p for p in products if p["id"] == "basic")
        reasoning = f"Basic coverage recommended based on the vehicle's value (${vehicle_value}) and risk assessment. This provides legally required protection at the lowest cost."

    # Create alternative options
    alternative_options = []
    for product in products:
        if product["id"] != recommended_product["id"]:
            if product["id"] == "premium":
                scenario = "If you want maximum peace of mind and are willing to pay more for comprehensive protection"
            elif product["id"] == "standard":
                scenario = "If you want a balance between cost and coverage"
            else:  # basic
                scenario = "If you're on a tight budget and only need the legally required minimum coverage"

            alternative_options.append({"product": product, "scenario": scenario})

    coverage_recommendation = {
        "recommended_product": recommended_product,
        "reasoning": reasoning,
        "alternative_options": alternative_options,
    }

    return {"coverage_recommendation": coverage_recommendation}


# Agent 5: Pricing Agent
@trace_agent("pricing_agent")
def pricing_agent(state: QuoteState) -> QuoteState:
    """Calculates the final price based on all factors"""
    risk_assessment = state.get("risk_assessment")
    coverage_recommendation = state.get("coverage_recommendation")

    # Trace data access
    trace_data_access("pricing_input", {
        "risk_assessment": risk_assessment,
        "coverage_recommendation": coverage_recommendation
    }, None)

    if not risk_assessment or not coverage_recommendation:
        raise ValueError("Missing required information for pricing calculation")

    # Get base premium from recommended product
    base_premium = coverage_recommendation["recommended_product"]["base_premium"]

    # Apply risk factors
    risk_factors = risk_assessment["risk_factors"]

    adjusted_premium = (
        base_premium
        * risk_factors["age_factor"]
        * risk_factors["history_factor"]
        * risk_factors["credit_factor"]
        * risk_factors["value_factor"]
    )

    # Apply discounts and surcharges
    if risk_factors["safety_discount"] > 0:
        adjusted_premium *= 1 - risk_factors["safety_discount"]

    if risk_factors["theft_surcharge"] > 0:
        adjusted_premium *= 1 + risk_factors["theft_surcharge"]

    # Round to nearest dollar
    final_premium = round(adjusted_premium)

    price_calculation = {
        "base_premium": base_premium,
        "adjusted_premium": final_premium,
        "discount_factors": {
            "safety_discount": risk_factors["safety_discount"] > 0,
        },
        "surcharge_factors": {
            "theft_surcharge": risk_factors["theft_surcharge"] > 0,
        },
    }

    return {"price_calculation": price_calculation}


# Agent 6: Quote Generation Agent
@trace_agent("quote_generation_agent")
def quote_generation_agent(state: QuoteState) -> QuoteState:
    """Generates the final quote with all details"""
    customer_info = state.get("customer_info")
    vehicle_info = state.get("vehicle_info")
    coverage_recommendation = state.get("coverage_recommendation")
    price_calculation = state.get("price_calculation")

    print("Generating quote...")

    # Trace data access
    trace_data_access("quote_generation_input", {
        "customer_info": customer_info,
        "vehicle_info": vehicle_info,
        "coverage_recommendation": coverage_recommendation,
        "price_calculation": price_calculation
    }, None)

    if (
        not customer_info
        or not vehicle_info
        or not coverage_recommendation
        or not price_calculation
    ):
        raise ValueError("Missing required information for quote generation")
    '''
    # For a more sophisticated approach, we can use the LLM to generate a personalized quote summary
    # Commented out unused prompt template
    # quote_prompt = ChatPromptTemplate.from_messages([
    #     SystemMessage(content="""You are an expert insurance quote generator. Your task is to create a comprehensive, 
    #     personalized insurance quote based on customer information, vehicle details, coverage recommendations, and pricing.
        
        Follow these guidelines:
        1. Generate a unique quote ID
        2. Include all relevant customer and vehicle information
        3. Detail the recommended coverage package and why it was selected
        4. Break down the premium calculation showing base premium and adjustments
        5. Include effective and expiration dates (use one year from now)
        6. Add personalized notes based on the customer's specific situation
        
        Your output should be structured as a JSON object with the following format:
        {
          "quote_id": "unique_id",
          "customer": {customer_summary},
          "vehicle": {vehicle_summary},
          "coverage": {coverage_details},
          "premium": {premium_amount},
          "premium_breakdown": {detailed_calculation},
          "effective_date": "YYYY-MM-DD",
          "expiration_date": "YYYY-MM-DD",
          "personalized_notes": ["note1", "note2"],
          "status": "approved|pending|rejected"
        }
        """),
        HumanMessage(content=f"""
        Please generate a comprehensive insurance quote based on the following information:
        
        Customer Information:
        {json.dumps(customer_info, indent=2)}
        
        Vehicle Information:
        {json.dumps(vehicle_info, indent=2)}
        
        Coverage Recommendation:
        {json.dumps(coverage_recommendation, indent=2)}
        
        Price Calculation:
        {json.dumps(price_calculation, indent=2)}
        """)
    ])
    '''
    # In a production system, we would call the LLM here
    # response = bedrock.invoke(quote_prompt)
    # final_quote = json.loads(response.content)

    # For now, we'll use our rule-based approach for consistency

    # Generate a unique quote ID (in a real system, this would be more sophisticated)
    quote_id = f"Q-{customer_info['id']}-{hash(str(vehicle_info)) % 10000:04d}"

    # Create premium breakdown
    premium_breakdown = {
        "base_premium": price_calculation["base_premium"],
        "adjustments": [],
    }

    # Add adjustments based on risk factors
    if "risk_assessment" in state and "risk_factors" in state["risk_assessment"]:
        risk_factors = state["risk_assessment"]["risk_factors"]

        # Age factor
        if risk_factors["age_factor"] != 1.0:
            premium_breakdown["adjustments"].append(
                {
                    "factor": "Age",
                    "multiplier": risk_factors["age_factor"],
                    "description": "Based on driver's age",
                }
            )

        # Driving history
        if risk_factors["history_factor"] != 1.0:
            premium_breakdown["adjustments"].append(
                {
                    "factor": "Driving History",
                    "multiplier": risk_factors["history_factor"],
                    "description": "Based on accidents and violations",
                }
            )

        # Credit score
        if risk_factors["credit_factor"] != 1.0:
            premium_breakdown["adjustments"].append(
                {
                    "factor": "Credit Score",
                    "multiplier": risk_factors["credit_factor"],
                    "description": "Based on credit history",
                }
            )

        # Vehicle value
        if risk_factors["value_factor"] != 1.0:
            premium_breakdown["adjustments"].append(
                {
                    "factor": "Vehicle Value",
                    "multiplier": risk_factors["value_factor"],
                    "description": f"Based on vehicle value of ${vehicle_info['value']}",
                }
            )

        # Safety discount
        if risk_factors["safety_discount"] > 0:
            premium_breakdown["adjustments"].append(
                {
                    "factor": "Safety Rating",
                    "multiplier": 1 - risk_factors["safety_discount"],
                    "description": f"Discount for high safety rating of {vehicle_info['safetyRating']}/5.0",
                }
            )

        # Theft surcharge
        if risk_factors["theft_surcharge"] > 0:
            premium_breakdown["adjustments"].append(
                {
                    "factor": "Theft Risk",
                    "multiplier": 1 + risk_factors["theft_surcharge"],
                    "description": f"Surcharge for high theft risk rating of {vehicle_info['theftRating']}/5.0",
                }
            )

    # Generate personalized notes
    personalized_notes = []

    # Clean driving record note
    if (
        customer_info["drivingHistory"]["accidents"] == 0
        and customer_info["drivingHistory"]["violations"] == 0
    ):
        personalized_notes.append(
            "Your clean driving record qualifies you for our safe driver discount."
        )

    # High safety rating note
    if vehicle_info["safetyRating"] >= 4.5:
        personalized_notes.append(
            f"Your {vehicle_info['year']} {vehicle_info['make']} {vehicle_info['model']} has an excellent safety rating, earning you a safety discount."
        )

    # Credit score note
    if customer_info["creditScore"] >= 750:
        personalized_notes.append(
            "Your excellent credit score has positively impacted your premium."
        )

    # Bundle suggestion
    personalized_notes.append(
        "Consider bundling with homeowners or renters insurance for additional savings."
    )

    # Create the final quote
    final_quote = {
        "quote_id": quote_id,
        "customer": {
            "id": customer_info["id"],
            "name": customer_info["name"],
            "age": customer_info["age"],
            "address": customer_info["address"],
        },
        "vehicle": {
            "make": vehicle_info["make"],
            "model": vehicle_info["model"],
            "year": vehicle_info["year"],
            "vin": vehicle_info.get("vin", "Unknown"),
            "value": vehicle_info["value"],
        },
        "coverage": coverage_recommendation["recommended_product"],
        "premium": price_calculation["adjusted_premium"],
        "premium_breakdown": premium_breakdown,
        "effective_date": "2025-07-01",  # In a real system, this would be dynamic
        "expiration_date": "2026-07-01",  # In a real system, this would be dynamic
        "personalized_notes": personalized_notes,
        "status": "approved",
    }

    return {"final_quote": final_quote}


# Define the workflow
def create_agent_workflow():
    """Create the multi-agent workflow for processing insurance quotes"""
    # Initialize the graph
    workflow = StateGraph(QuoteState)

    # Add nodes with different names than state keys
    workflow.add_node("customer_info_agent", customer_information_agent)
    workflow.add_node("vehicle_info_agent", vehicle_information_agent)
    workflow.add_node("risk_assessment_agent", risk_assessment_agent)
    workflow.add_node("coverage_determination_agent", coverage_determination_agent)
    workflow.add_node("pricing_agent", pricing_agent)
    workflow.add_node("quote_generation_agent", quote_generation_agent)

    # Add edges
    workflow.add_edge("customer_info_agent", "risk_assessment_agent")
    workflow.add_edge("vehicle_info_agent", "risk_assessment_agent")
    workflow.add_edge("risk_assessment_agent", "coverage_determination_agent")
    workflow.add_edge("coverage_determination_agent", "pricing_agent")
    workflow.add_edge("pricing_agent", "quote_generation_agent")
    workflow.add_edge("quote_generation_agent", END)

    # Set entry points
    workflow.set_entry_point("customer_info_agent")
    workflow.set_entry_point("vehicle_info_agent")

    # Compile the workflow
    return workflow.compile()


# Create the agent workflow
agent_workflow = create_agent_workflow()


def process_quote_request(request_data):
    """Process a quote request through the agent workflow"""
    # Initialize the state with the request data
    initial_state = {
        "customer_id": request_data["customer_id"],
        "vehicle_info": request_data["vehicle_info"],
        "customer_info": None,
        "risk_assessment": None,
        "coverage_recommendation": None,
        "price_calculation": None,
        "final_quote": None,
    }

    logger.info(f"Initial state: {initial_state}")

    # Run the workflow
    result = agent_workflow.invoke(initial_state)

    # Return the final quote and traces
    return {
        "final_quote": result["final_quote"],
        "traces": get_traces()
    }

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
    workflow = StateGraph(nodes=[
        "customer_info",
        "vehicle_info",
        "risk_assessment",
        "coverage_determination",
        "pricing",
        "quote_generation"
    ])
    
    # Add edges with conditional transitions
    def validate_customer_data(state):
        return "vehicle_info" if state.get("customer_info") else "customer_info"
    
    def validate_vehicle_data(state):
        return "risk_assessment" if state.get("vehicle_info") else "vehicle_info"
    
    def validate_risk_data(state):
        return "coverage_determination" if state.get("risk_assessment") else "risk_assessment"
    
    def validate_coverage_data(state):
        return "pricing" if state.get("coverage_recommendation") else "coverage_determination"
    
    def validate_pricing_data(state):
        return "quote_generation" if state.get("price_calculation") else "pricing"
    
    def validate_quote_data(state):
        return END if state.get("final_quote") else "quote_generation"
    
    # Add the edges with validation
    workflow.add_edge("customer_info", validate_customer_data)
    workflow.add_edge("vehicle_info", validate_vehicle_data)
    workflow.add_edge("risk_assessment", validate_risk_data)
    workflow.add_edge("coverage_determination", validate_coverage_data)
    workflow.add_edge("pricing", validate_pricing_data)
    workflow.add_edge("quote_generation", validate_quote_data)
    
    # Set the agents for each node
    workflow.set_node("customer_info", customer_information_agent)
    workflow.set_node("vehicle_info", vehicle_information_agent)
    workflow.set_node("risk_assessment", risk_assessment_agent)
    workflow.set_node("coverage_determination", coverage_determination_agent)
    workflow.set_node("pricing", pricing_agent)
    workflow.set_node("quote_generation", quote_generation_agent)
    
    logger.info("Created enhanced quote workflow with validation and error handling")
    
    return workflow

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
    test_customer_id = "CUST001"
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
