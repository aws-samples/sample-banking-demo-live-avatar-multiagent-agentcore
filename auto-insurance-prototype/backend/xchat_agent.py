"""
Auto Insurance Chat Agent

This module implements a conversational agent for processing car insurance quote requests
through natural language. It uses Amazon Bedrock with Claude 3 Sonnet to extract relevant
information from customer chat messages and guide them through the quote process.
"""

import json
import os
from typing import Dict
from dotenv import load_dotenv
from langchain_aws import ChatBedrock
from langchain.prompts import ChatPromptTemplate
from langchain.schema import SystemMessage, HumanMessage

# Load environment variables
load_dotenv()

# Initialize Bedrock client
bedrock_model_id = os.getenv(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-sonnet-20240229-v1:0"
)
bedrock = ChatBedrock(
    model_id=bedrock_model_id,
    region_name=os.getenv("AWS_REGION", "us-west-2"),
    streaming=False,  # Set to False for synchronous responses
    model_kwargs={
        "temperature": 0.7,
        "max_tokens": 1000
    },
)

# Load mock data
data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

with open(os.path.join(data_dir, "vehicles.json"), "r") as f:
    vehicles = json.load(f)


class ChatAgent:
    """Chat agent for processing insurance quote requests through natural language"""

    def __init__(self):
        self.conversation_history = []
        self.extracted_info = {"vehicle_info": {}, "coverage_preferences": {}}

    def process_message(self, customer_id: str, message: str) -> Dict:
        """Process a customer message and extract relevant information"""

        # Add the message to conversation history
        self.conversation_history.append({"role": "user", "content": message})
        
        # Create the prompt for information extraction
        extraction_prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content="""You are an AI assistant for an auto insurance company. Your task is to extract 
            relevant information from customer messages for generating insurance quotes. You should also provide a helpful,
            friendly response that guides the customer through the quote process.
            
            Extract the following information when present in the customer's message:
            1. Vehicle details: make, model, year, value, VIN
            2. Coverage preferences: liability limits, deductible amounts, additional coverages
            3. Driver information: age, driving history, accidents, violations
            
            Your response should include:
            1. A JSON object with the extracted information
            2. A natural, conversational response to the customer
            3. Questions to gather any missing critical information
            
            Format your response as follows:
            
            {
              "extracted_info": {
                "vehicle_info": {
                  "make": "extracted or null",
                  "model": "extracted or null",
                  "year": number or null,
                  "value": number or null,
                  "vin": "extracted or null"
                },
                "coverage_preferences": {
                  "liability": "extracted or null",
                  "collision_deductible": number or null,
                  "comprehensive_deductible": number or null,
                  "additional_coverages": ["list", "of", "coverages"]
                }
              },
              "response": "Your natural language response to the customer",
              "missing_info": ["list", "of", "critical", "missing", "information"]
            }
            """),
            HumanMessage(content=f"""
            Customer ID: {customer_id}
            
            Conversation history:
            {json.dumps(self.conversation_history, indent=2)}
            
            Current extracted information:
            {json.dumps(self.extracted_info, indent=2)}
            
            Please process the latest customer message and provide your response.
            """)
        ])
        
        # Call the LLM to process the message
        try:
            print(f"DEBUG: Invoking Bedrock with prompt type: {type(extraction_prompt)}")
            
            # Try to convert the prompt to messages first
            try:
                messages = extraction_prompt.format_messages()
                print(f"DEBUG: Converted to messages type: {type(messages)}")
                response = bedrock.invoke(messages)
            except Exception as format_error:
                print(f"DEBUG: Error formatting messages: {str(format_error)}")
                # Fall back to direct invocation
                response = bedrock.invoke(extraction_prompt)
            
            print(f"DEBUG: Bedrock response type: {type(response)}")
            
            # Parse the response to extract the JSON
            response_text = response.content
            print(f"DEBUG: Response content: {response_text[:100]}...")
            
            # Find JSON in the response
            import re
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            
            print(f"DEBUG: JSON match found: {json_match is not None}")
            
            if json_match:
                json_str = json_match.group(0)
                print(f"DEBUG: Extracted JSON string: {json_str[:100]}...")
                try:
                    result = json.loads(json_str)
                    print(f"DEBUG: Successfully parsed JSON")
                except json.JSONDecodeError as json_err:
                    print(f"DEBUG: JSON parsing error: {str(json_err)}")
                    # Fallback if JSON parsing fails
                    result = {
                        "extracted_info": self.extracted_info,
                        "response": "I'm sorry, I couldn't process your request properly. Could you please provide more details about your vehicle and coverage needs?",
                        "missing_info": ["vehicle details", "coverage preferences"]
                    }
            else:
                # Fallback if no JSON is found
                print(f"DEBUG: No JSON found in response")
                result = {
                    "extracted_info": self.extracted_info,
                    "response": "I'm sorry, I couldn't process your request properly. Could you please provide more details about your vehicle and coverage needs?",
                    "missing_info": ["vehicle details", "coverage preferences"]
                }
                
            # Update the extracted information with new data
            if "extracted_info" in result and "vehicle_info" in result["extracted_info"]:
                for key, value in result["extracted_info"]["vehicle_info"].items():
                    if value and value != "null":
                        self.extracted_info["vehicle_info"][key] = value
                        
            if "extracted_info" in result and "coverage_preferences" in result["extracted_info"]:
                for key, value in result["extracted_info"]["coverage_preferences"].items():
                    if value and value != "null":
                        self.extracted_info["coverage_preferences"][key] = value
            
            # Add the response to conversation history
            if "response" in result:
                self.conversation_history.append({"role": "assistant", "content": result["response"]})
            
            return {
                "extracted_info": self.extracted_info,
                "response": result.get("response", "I'm processing your request."),
                "missing_info": result.get("missing_info", [])
            }
            
        except Exception as e:
            print(f"ERROR: Error processing message with LLM: {str(e)}")
            print(f"ERROR: Exception type: {type(e)}")
            import traceback
            print(f"ERROR: Traceback: {traceback.format_exc()}")
            
            # Fallback to a simple response
            fallback_response = "I'm sorry, I encountered an issue processing your request. Could you please provide details about your vehicle and coverage needs?"
            self.conversation_history.append({"role": "assistant", "content": fallback_response})
            
            return {
                "extracted_info": self.extracted_info,
                "response": fallback_response,
                "missing_info": ["vehicle details", "coverage preferences"]
            }

    def reset_conversation(self):
        # Reset the conversation history and extracted information
        self.conversation_history = []
        self.extracted_info = {
            "vehicle_info": {},
            "coverage_preferences": {}
        }

# Create a singleton instance
chat_agent = ChatAgent()

def process_chat_message(customer_id: str, message: str) -> Dict:
    # Process a chat message and extract relevant information
    return chat_agent.process_message(customer_id, message)

def reset_chat():
    # Reset the chat agent's conversation history and extracted information
    chat_agent.reset_conversation()
