FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    PYTHONUNBUFFERED=1

# Install agent-specific requirements
COPY patterns/livekit-agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt

# Create non-root user
RUN useradd -m -u 1000 livekit
USER livekit

# Copy shared utilities and the bank persona prompts (reused from the avatar).
COPY patterns/utils/ utils/
COPY patterns/avatar-agent/persona_prompts.py .
COPY patterns/livekit-agent/livekit_agent.py .

# Download any model files the plugin needs (turn detection, VAD), then run
# the worker in production mode. `start` connects to the LiveKit server using
# LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET from the environment.
RUN python livekit_agent.py download-files || true

CMD ["python", "livekit_agent.py", "start"]
