#!/usr/bin/env bash
# Local dev launcher for the Pipecat backend.
#
# Why this script exists:
#   - NLTK_DISABLE_IMPORT_SECURITY=1 : the venv lives inside the project dir, so
#     nltk's CWD import guard false-positives on venv packages. This disables it.
#   - DEMO_API_TOKEN : server.py gates POST /start and /api/* behind this token.
#     The frontend shows a password screen; enter the same value here.
#
# Usage:
#   ./run-local.sh            # starts the backend on http://localhost:7860
#   Then in another terminal: (cd frontend && npm start)
#   Open http://localhost:3000 and enter the password below.

set -euo pipefail
cd "$(dirname "$0")"

# Password for the frontend's access gate. Change if you like.
export DEMO_API_TOKEN="${DEMO_API_TOKEN:-local-dev-token}"
# Work around nltk's current-working-directory import guard (venv is in-project).
export NLTK_DISABLE_IMPORT_SECURITY=1

echo "Backend password (enter this in the browser): $DEMO_API_TOKEN"
echo "Starting Pipecat backend on http://localhost:7860 ..."

exec ./env/bin/python server.py --transport webrtc --host localhost --port 7860
