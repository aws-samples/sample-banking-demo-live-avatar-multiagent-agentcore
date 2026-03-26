# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Research Orchestrator — Durable Functions stub.

Demonstrates the multi-agent orchestration pattern:
  planner → researcher → synthesizer → pdf_writer

When Lambda Durable Functions becomes GA, this will use the durable
orchestration API to coordinate the 4 research agents. For now it
invokes them sequentially via the AgentCore Runtime SDK.
"""

import json
import logging
import os

logger = logging.getLogger()
logger.setLevel(logging.INFO)

STACK_NAME = os.environ.get("STACK_NAME", "")


def handler(event, context):
    """
    Research orchestration tool Lambda handler.

    Accepts a research query and coordinates the planner → researcher →
    synthesizer → pdf_writer pipeline. Currently a stub that returns the
    planned execution steps.
    """
    logger.info("Received event: %s", json.dumps(event))

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info("Processing tool: %s", tool_name)

        if tool_name == "research_orchestrator":
            query = event.get("query", "")
            if not query:
                return {"error": "Missing required parameter: query"}

            # Collect runtime ARNs from environment
            runtime_arns = {}
            for key, value in os.environ.items():
                if key.startswith("RUNTIME_ARN_"):
                    agent_name = key.replace("RUNTIME_ARN_", "").lower()
                    runtime_arns[agent_name] = value

            # TODO: When Lambda Durable Functions is GA, replace this stub
            # with actual durable orchestration:
            #
            #   from aws_lambda_durable import workflow, activity
            #
            #   @workflow
            #   def research_pipeline(ctx, query):
            #       plan = yield ctx.call_activity(invoke_planner, query)
            #       findings = yield ctx.call_activity(invoke_researcher, plan)
            #       synthesis = yield ctx.call_activity(invoke_synthesizer, findings)
            #       report = yield ctx.call_activity(invoke_pdf_writer, synthesis)
            #       return report

            result = {
                "status": "stub",
                "message": (
                    "Research orchestrator stub — Durable Functions not yet GA. "
                    "Pipeline would execute: planner → researcher → synthesizer → pdf_writer"
                ),
                "query": query,
                "pipeline_steps": [
                    {
                        "step": 1,
                        "agent": "planner",
                        "arn": runtime_arns.get("planner", "N/A"),
                    },
                    {
                        "step": 2,
                        "agent": "researcher",
                        "arn": runtime_arns.get("researcher", "N/A"),
                    },
                    {
                        "step": 3,
                        "agent": "synthesizer",
                        "arn": runtime_arns.get("synthesizer", "N/A"),
                    },
                    {
                        "step": 4,
                        "agent": "pdf_writer",
                        "arn": runtime_arns.get("pdf_writer", "N/A"),
                    },
                ],
            }

            return {"content": [{"type": "text", "text": json.dumps(result)}]}
        else:
            return {"error": f"This Lambda only supports 'research_orchestrator', received: {tool_name}"}

    except Exception as e:
        logger.error("Error processing request: %s", str(e), exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
