"""
Tracing module for the auto insurance multi-agent system.

This module provides tracing functionality to log agent activities,
data access, and tool usage throughout the system.
"""

import json
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
import logging
import threading

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("agent_tracing")

# Thread-local storage for trace context
_trace_context = threading.local()

# Global trace storage
_traces = []
_trace_enabled = True

class AgentTrace:
    """Class representing a single agent trace entry"""
    def __init__(
        self,
        agent_id: str,
        status: str = "started",
        input_data: Optional[Dict[str, Any]] = None,
    ):
        self.agent_id = agent_id
        self.status = status
        self.timestamp = datetime.now().isoformat()
        self.start_time = time.time()
        self.input = input_data or {}
        self.output = None
        self.reasoning = None
        self.duration_ms = None
        self.error = None
        
    def complete(self, output: Dict[str, Any], reasoning: Optional[str] = None):
        """Mark the trace as completed with output and reasoning"""
        self.status = "completed"
        self.output = output
        self.reasoning = reasoning
        self.duration_ms = int((time.time() - self.start_time) * 1000)
        
    def fail(self, error: str):
        """Mark the trace as failed with error information"""
        self.status = "error"
        self.error = error
        self.duration_ms = int((time.time() - self.start_time) * 1000)
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert the trace to a dictionary representation"""
        result = {
            "agentId": self.agent_id,
            "status": self.status,
            "timestamp": self.timestamp,
            "input": self.input,
            "durationMs": self.duration_ms
        }
        
        if self.output:
            result["output"] = self.output
            
        if self.reasoning:
            result["reasoning"] = self.reasoning
            
        if self.error:
            result["error"] = self.error
            
        return result


def enable_tracing():
    """Enable the tracing system"""
    global _trace_enabled
    _trace_enabled = True
    logger.info("Tracing enabled")


def disable_tracing():
    """Disable the tracing system"""
    global _trace_enabled
    _trace_enabled = False
    logger.info("Tracing disabled")


def is_tracing_enabled() -> bool:
    """Check if tracing is enabled"""
    return _trace_enabled


def clear_traces():
    """Clear all stored traces"""
    global _traces
    _traces = []
    logger.info("Traces cleared")


def get_traces() -> List[Dict[str, Any]]:
    """Get all stored traces"""
    return [trace.to_dict() for trace in _traces]


def start_trace(agent_id: str, input_data: Optional[Dict[str, Any]] = None) -> Optional[AgentTrace]:
    """Start a new trace for an agent"""
    if not _trace_enabled:
        return None
        
    trace = AgentTrace(agent_id=agent_id, input_data=input_data)
    _traces.append(trace)
    
    # Store in thread-local context
    _trace_context.current_trace = trace
    
    logger.info(f"Agent {agent_id} started processing")
    print(f"TRACE: Agent {agent_id} started processing with input: {json.dumps(input_data)}")
    
    return trace


def complete_trace(output: Dict[str, Any], reasoning: Optional[str] = None):
    """Complete the current trace with output and reasoning"""
    if not _trace_enabled or not hasattr(_trace_context, 'current_trace'):
        return
        
    trace = _trace_context.current_trace
    trace.complete(output, reasoning)
    
    logger.info(f"Agent {trace.agent_id} completed processing in {trace.duration_ms}ms")
    print(f"TRACE: Agent {trace.agent_id} completed with output: {json.dumps(output)}")
    if reasoning:
        print(f"TRACE: Agent {trace.agent_id} reasoning: {reasoning}")
    
    # Clear the current trace from context
    del _trace_context.current_trace


def fail_trace(error: str):
    """Mark the current trace as failed"""
    if not _trace_enabled or not hasattr(_trace_context, 'current_trace'):
        return
        
    trace = _trace_context.current_trace
    trace.fail(error)
    
    logger.error(f"Agent {trace.agent_id} failed: {error}")
    print(f"TRACE: Agent {trace.agent_id} failed with error: {error}")
    
    # Clear the current trace from context
    del _trace_context.current_trace


def trace_data_access(data_source: str, query: Any, result: Any):
    """Log data access operations"""
    if not _trace_enabled:
        return
        
    logger.info(f"Data access: {data_source} - Query: {query}")
    print(f"TRACE: Data access to {data_source} with query: {query}")


def trace_tool_use(tool_name: str, inputs: Dict[str, Any], outputs: Any):
    """Log tool usage"""
    if not _trace_enabled:
        return
        
    logger.info(f"Tool use: {tool_name}")
    print(f"TRACE: Tool {tool_name} called with inputs: {json.dumps(inputs)}")
    print(f"TRACE: Tool {tool_name} returned: {json.dumps(outputs)}")


# Decorator for tracing agent functions
def trace_agent(agent_id: str = None):
    """Decorator to trace agent function execution"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            # Get agent_id from function name if not provided
            nonlocal agent_id
            if agent_id is None:
                agent_id = func.__name__
                
            # Extract state from args (assuming first arg is state)
            input_data = args[0] if args else {}
            
            # Start trace
            trace = start_trace(agent_id, input_data)
            
            try:
                # Call the original function
                result = func(*args, **kwargs)
                
                # Complete trace
                if trace:
                    reasoning = f"Executed {agent_id} successfully"
                    complete_trace(result, reasoning)
                    
                return result
                
            except Exception as e:
                # Fail trace
                if trace:
                    fail_trace(str(e))
                raise
                
        return wrapper
    return decorator
