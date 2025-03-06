FROM --platform=linux/amd64 python:3.8-slim-bookworm as build

# Copy your application files
WORKDIR /app
COPY . .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Start the Chainlit app using your run.sh script
CMD ["python3", "sim.py"] 