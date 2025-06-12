# Auto Insurance Quote Multi-Agent System Prototype

This prototype demonstrates a multi-agent system for processing car insurance quotes using LangGraph for the backend agents and React with Cloudscape for the frontend UI.

## Project Structure

```
auto-insurance-prototype/
├── backend/
│   ├── app.py                # FastAPI application
│   ├── agent_system.py       # LangGraph multi-agent system
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── public/               # Public assets
│   ├── src/                  # React source code
│   │   ├── components/       # Reusable UI components
│   │   │   ├── Navigation.js # Navigation sidebar
│   │   │   └── ChatInterface.js # Chatbot interface
│   │   ├── pages/            # Application pages
│   │   │   ├── Dashboard.js  # Main dashboard
│   │   │   ├── QuoteForm.js  # Form-based quote request
│   │   │   ├── ChatQuote.js  # Chatbot-based quote request
│   │   │   ├── QuoteResult.js # Quote result display
│   │   │   └── CustomerProfile.js # Customer information
│   │   ├── App.js            # Main application component
│   │   └── index.js          # Entry point
│   └── package.json          # Node.js dependencies
└── data/
    ├── customers.json        # Mock customer data
    ├── credit_reports.json   # Mock credit report data
    ├── policies.json         # Mock policy data
    ├── products.json         # Insurance product definitions
    ├── pricing_rules.json    # Rules for calculating premiums
    └── vehicles.json         # Vehicle information
```

## Multi-Agent System

The system consists of six specialized agents:

1. **Customer Information Agent**: Retrieves and analyzes customer information
2. **Vehicle Information Agent**: Retrieves and analyzes vehicle information
3. **Risk Assessment Agent**: Assesses risk based on customer and vehicle information
4. **Coverage Determination Agent**: Determines appropriate coverage based on customer request and risk assessment
5. **Pricing Agent**: Calculates the final price based on all factors
6. **Quote Generation Agent**: Generates the final quote with all details

## AWS Integration

This prototype uses Amazon Bedrock with Anthropic Claude 3 Sonnet for natural language processing:

- **Region**: us-west-2
- **Model**: anthropic.claude-3-sonnet-20240229-v1:0
- **Integration**: Uses boto3 and langchain-aws for seamless AWS integration

## User Interaction Methods

The prototype offers two ways for users to get insurance quotes:

1. **Form-based Interface**: Traditional form with fields for vehicle and coverage information
2. **Chatbot Interface**: Conversational AI assistant that guides users through the quote process

The chatbot interface uses Claude 3 Sonnet via Amazon Bedrock to process natural language and extract the necessary information.

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:

    ```
    cd auto-insurance-prototype/backend
    ```

2. Create a virtual environment:

    ```
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```

3. Install dependencies:

    ```
    pip install -r requirements.txt
    ```

4. Create a `.env` file with your AWS region:

    ```
    cp .env.example .env
    # Edit .env if needed to change the AWS region
    ```

5. Configure AWS credentials:

    ```
    aws configure
    # Enter your AWS credentials with permissions to access Bedrock
    ```

6. Start the backend server:
    ```
    python app.py
    ```

### Frontend Setup

1. Navigate to the frontend directory:

    ```
    cd auto-insurance-prototype/frontend
    ```

2. Install dependencies:

    ```
    npm install
    ```

3. Start the development server:

    ```
    npm start
    ```

4. Open your browser to http://localhost:3000

## Usage

1. Log in as an existing customer (for demo purposes, a customer is pre-selected)
2. Choose between the form-based quote or chatbot interface
3. For the form-based approach:
    - Fill in the vehicle information and coverage options
    - Submit the form to get a quote
4. For the chatbot approach:
    - Chat with the AI assistant about your insurance needs
    - The assistant will guide you through the process and extract the necessary information
    - Once all information is collected, a quote will be generated
5. View the quote details and premium breakdown

## Mock Data

The prototype uses mock data for:

- Customer profiles
- Credit reports
- Vehicle information
- Insurance products and pricing rules
- Existing policies

This allows the system to demonstrate the full quote generation process without requiring external API calls.

## Future Enhancements

- Enhance the chatbot with more sophisticated prompts for Claude
- Add authentication and user management
- Implement policy purchase workflow
- Add payment processing
- Expand agent capabilities for more complex scenarios
- Deploy to AWS cloud infrastructure using CDK
