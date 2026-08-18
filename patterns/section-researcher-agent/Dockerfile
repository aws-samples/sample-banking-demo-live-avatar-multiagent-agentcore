# Section-Researcher Agent — A2A server runtime.
# Built for LINUX_ARM64 (Graviton); the platform is pinned by the CDK
# DockerImageAsset (see lib/stacks/backend, task 15). Mirrors the shape of the
# fraud-research-agent Dockerfile.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# Configure UV for container environment
ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    OTEL_PYTHON_LOG_CORRELATION=true \
    PYTHONUNBUFFERED=1

# Copy and install agent-specific requirements
# Cache-bust: A2A server (strands-agents[a2a] + bedrock-agentcore)
COPY patterns/section-researcher-agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt && \
    uv pip install --no-cache aws-opentelemetry-distro==0.10.1

# Install requests for auth utilities
RUN uv pip install --no-cache requests>=2.31.0

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

# A2A servers run on port 9000 at root path "/" (vs 8080 for HTTP runtimes).
EXPOSE 9000

# Copy shared utilities and agent code
COPY patterns/utils/ utils/
COPY patterns/section-researcher-agent/agent_card.py .
COPY patterns/section-researcher-agent/system_prompt.txt .
COPY patterns/section-researcher-agent/section_researcher_agent.py .

# Healthcheck using Python (no extra dependencies needed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:9000/ping', timeout=2)" || exit 1

# Start the A2A server with OpenTelemetry instrumentation (one-trace tracing
# across the A2A hop). serve_a2a binds 0.0.0.0:9000 by default.
CMD ["opentelemetry-instrument", "python", "section_researcher_agent.py"]
