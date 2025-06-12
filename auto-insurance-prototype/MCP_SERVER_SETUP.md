# MCP Server Setup for Auto Insurance System

## Overview

The MCP (Model Context Protocol) server provides external data integration for the auto insurance quote system. While optional, it enables advanced features like real-time data access and external API integration.

## Quick Start

### Option 1: No MCP Server (Recommended for Testing)
The system works perfectly without MCP server - it automatically uses local JSON data:

```bash
# Just start the backend - it will use local data fallback
cd backend
python app.py
```

You'll see logs indicating fallback to local data sources.

### Option 2: Mock MCP Server (For Development)
Create a simple mock MCP server for testing:

```bash
# Create a simple mock server
cd backend
python -c "
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

class MockMCPHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/customer_info':
            self.send_response(500)  # Simulate server error to test fallback
        elif self.path == '/vehicle_info':
            # Return mock vehicle data
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                'status': 'success',
                'vehicle_info': {
                    'make': 'Toyota',
                    'model': 'Camry',
                    'year': 2024,
                    'category': 'standard',
                    'safety_rating': '5_star',
                    'value': 30000,
                    'age': 1,
                    'display_name': '2024 Toyota Camry',
                    'is_new': True,
                    'current_value': 24000.0
                }
            }
            self.wfile.write(json.dumps(response).encode())
        elif self.path == '/customer_credit':
            # Return mock credit data
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                'status': 'success',
                'credit_info': {
                    'customer_id': 'cust-001',
                    'credit_score': 720,
                    'report_date': '2025-05-01',
                    'payment_history': 'good',
                    'debt_to_income_ratio': 0.28,
                    'bankruptcies': 0,
                    'collections': 0,
                    'risk_level': 'medium'
                }
            }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_GET(self):
        if self.path == '/health':
            self.send_response(404)  # Simulate health check failure
        else:
            self.send_response(404)
        self.end_headers()

print('Starting Mock MCP Server on port 8001...')
server = HTTPServer(('localhost', 8001), MockMCPHandler)
server.serve_forever()
"
```

This mock server demonstrates the fallback behavior - some endpoints work, others fail and trigger fallback.

### Option 3: Full MCP Server Implementation

For a production MCP server, you would implement endpoints for:

#### Required Endpoints:
- `POST /customer_info` - Customer data
- `POST /customer_credit` - Credit information  
- `POST /vehicle_info` - Vehicle details
- `POST /vehicle_safety` - Safety ratings
- `GET /health` - Health check

#### Optional Endpoints:
- `POST /customer_policies` - Existing policies
- `POST /insurance_products` - Available products
- `POST /pricing_rules` - Pricing factors
- `POST /risk_factors` - Risk calculations
- `POST /save_quote` - Quote storage

#### Example Implementation:
```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Insurance MCP Server")

class CustomerRequest(BaseModel):
    customer_id: str

@app.post("/customer_info")
async def get_customer_info(request: CustomerRequest):
    # Connect to your customer database
    # Return customer information
    return {
        "status": "success",
        "customer_info": {
            "id": request.customer_id,
            "name": "John Smith",
            # ... other customer data
        }
    }

@app.post("/vehicle_info") 
async def get_vehicle_info(request: dict):
    # Connect to vehicle database/API
    # Return vehicle information
    return {
        "status": "success", 
        "vehicle_info": {
            "make": request["make"],
            "model": request["model"],
            # ... other vehicle data
        }
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

## Testing MCP Integration

### 1. Test MCP Server Directly
```bash
# Health check
curl http://localhost:8001/health

# Customer info
curl -X POST http://localhost:8001/customer_info \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "cust-001"}'

# Vehicle info  
curl -X POST http://localhost:8001/vehicle_info \
  -H "Content-Type: application/json" \
  -d '{"make": "Toyota", "model": "Camry", "year": 2024}'
```

### 2. Test Backend Integration
```bash
# Check system health (shows MCP status)
curl http://localhost:8000/api/system/health

# Generate quote (will use MCP if available)
curl -X POST http://localhost:8000/api/quotes \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "cust-001",
    "vehicle_info": {
      "make": "Toyota",
      "model": "Camry", 
      "year": 2024
    }
  }'
```

### 3. Monitor Data Sources
The backend logs will show which data source is used:
```
INFO - Successfully retrieved customer_info from MCP server
INFO - MCP server access failed, falling back to local data
INFO - Successfully retrieved vehicle_info from local fallback
```

## Configuration

### Backend Configuration (.env)
```bash
# MCP Server settings
MCP_SERVER_URL=http://localhost:8001
USE_MCP_SERVER=true
ENABLE_FALLBACK=true
MCP_TIMEOUT=30
```

### Data Flow
```
Frontend Request
    ↓
Backend API
    ↓
Multi-Agent System
    ↓
Data Access Layer
    ↓
MCP Server (Primary) → Local JSON (Fallback)
```

## Benefits of MCP Integration

1. **Real-time Data**: Access to live customer, vehicle, and market data
2. **External APIs**: Integration with credit bureaus, vehicle databases, etc.
3. **Scalability**: Centralized data access across multiple services
4. **Flexibility**: Easy to add new data sources without changing agents
5. **Reliability**: Automatic fallback ensures system availability

## Conclusion

The MCP server is optional but provides significant benefits for production deployments. The system's automatic fallback mechanism ensures it works perfectly whether MCP is available or not, making it ideal for development and testing scenarios.
