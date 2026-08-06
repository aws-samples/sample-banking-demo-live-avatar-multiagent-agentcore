FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    DOCKER_CONTAINER=1 \
    PYTHONUNBUFFERED=1

# Install agent-specific requirements
COPY patterns/tavus-pipecat-agent/requirements.txt requirements.txt
RUN uv pip install --no-cache -r requirements.txt

# Create non-root user
RUN useradd -m -u 1000 pipecat
USER pipecat

# Copy shared utilities and the bank persona prompts (reused from the avatar).
COPY patterns/utils/ utils/
COPY patterns/avatar-agent/persona_prompts.py .
COPY patterns/avatar-agent/system_prompt_augmenter.py .

# Copy the worker modules.
COPY patterns/tavus-pipecat-agent/scope.py .
COPY patterns/tavus-pipecat-agent/voice_replica.py .
COPY patterns/tavus-pipecat-agent/transcript_forwarders.py .
COPY patterns/tavus-pipecat-agent/gateway_toolset.py .
COPY patterns/tavus-pipecat-agent/tavus_pipecat_agent.py .
COPY patterns/tavus-pipecat-agent/server.py .

# The server binds the offer/signaling + health endpoint on 7860. Media flows
# over WebRTC UDP directly between the browser and this task.
EXPOSE 7860

# server.py serves the ALB /health check and the /start endpoint that drives
# TavusTransport. Auth is enforced upstream by the offer Lambda.
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "7860"]

