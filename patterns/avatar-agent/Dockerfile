FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Configure UV for container environment
ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    PYTHONUNBUFFERED=1

# Install build dependencies for pyaudio (required by strands-agents[bidi-all])
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libasound-dev \
    libportaudio2 \
    libportaudiocpp0 \
    portaudio19-dev \
    gcc \
    python3-dev && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy and install agent-specific requirements
# Cache-bust: mandatory tool use prompts
COPY patterns/avatar-agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080

# Copy shared utilities
COPY patterns/utils/ utils/

# Copy avatar agent code and supporting modules
COPY patterns/avatar-agent/avatar_agent.py .
COPY patterns/avatar-agent/persona_prompts.py .
COPY patterns/avatar-agent/system_prompt_augmenter.py .

# Healthcheck using Python (no extra dependencies needed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/ping', timeout=2)" || exit 1

# Start with uvicorn (matching aws-samples/sample-nova-sonic-websocket-agentcore pattern)
CMD ["uvicorn", "avatar_agent:app", "--host", "0.0.0.0", "--port", "8080"]
