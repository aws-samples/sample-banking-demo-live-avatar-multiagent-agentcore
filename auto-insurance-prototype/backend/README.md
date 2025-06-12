# Auto Insurance Quote System - Backend

This backend implements a multi-agent system for processing car insurance quotes using LangGraph.

## Tracing System

The system includes a comprehensive tracing mechanism that logs:

1. Agent invocations and their inputs/outputs
2. Data access operations
3. Tool usage
4. Processing time and status

Traces are printed to the console in real-time and can be accessed via the `/agent-traces` API endpoint.

## Setup Instructions

1. Create a virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Configure AWS credentials:
   ```
   aws configure
   # Enter your AWS credentials with permissions to access Bedrock
   ```

4. Start the backend server:
   ```
   python app.py
   ```

## API Endpoints

- `GET /agent-traces` - Get all agent traces
- `POST /quotes` - Generate an insurance quote
- `POST /chat` - Process a chat message and extract quote information

## Tracing Usage

The tracing system is enabled by default. You can control it with:

```python
from tracing import enable_tracing, disable_tracing, clear_traces, get_traces

# Enable/disable tracing
enable_tracing()
disable_tracing()

# Clear all traces
clear_traces()

# Get all traces
traces = get_traces()
```

To trace a function, use the `@trace_agent` decorator:

```python
from tracing import trace_agent

@trace_agent("agent_name")
def my_agent_function(state):
    # Function implementation
    return updated_state
```

To trace data access:

```python
from tracing import trace_data_access

trace_data_access("data_source", query, result)
```

To trace tool usage:

```python
from tracing import trace_tool_use

trace_tool_use("tool_name", inputs, outputs)
```
