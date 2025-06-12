#!/usr/bin/env python3
"""
Start the enhanced auto insurance quote API server
"""

import uvicorn
import sys
import os

# Add the current directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("🚀 Starting Enhanced Auto Insurance Quote API Server...")
    print("📊 Features:")
    print("   - Multi-Agent Quote Generation")
    print("   - MCP Server Integration with Fallback")
    print("   - Comprehensive Risk Assessment")
    print("   - Real-time Processing Traces")
    print("   - Enhanced Chat Interface")
    print()
    print("🌐 Server will be available at: http://localhost:8000")
    print("📖 API Documentation: http://localhost:8000/docs")
    print()
    
    uvicorn.run(
        "app_enhanced:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True,
        log_level="info"
    )
