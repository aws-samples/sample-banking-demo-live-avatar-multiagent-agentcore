# Trinity Reserve Voice — SageMaker AI Fine-Tuning Assets

Fine-tune a foundation model on **Trinity Reserve Bank's approved communications** so the customer agent speaks in the bank's voice — composed, plain, honest about fees and risk — instead of a generic assistant voice. Then deploy that model and wire it into the agent's configuration.

> **Synthetic demonstration content.** Trinity Reserve Bank is a _proposed_ institution created for an AWS demo. Every letter, rate, and figure here is made up. Nothing is a real financial disclosure, offer, or piece of regulatory text.

These assets are built to **showcase Amazon SageMaker AI managed services** end to end:

| Stage                                         | Managed service              |
| --------------------------------------------- | ---------------------------- |
| No-code exploration & side-by-side comparison | **SageMaker Canvas**         |
| Base model + managed training container       | **SageMaker JumpStart**      |
| Orchestrated, repeatable, auditable MLOps     | **SageMaker Pipelines**      |
| Governance / human approval gate              | **SageMaker Model Registry** |
| Managed real-time inference                   | **SageMaker Endpoint**       |

## Why fine-tune here

The customer agent already has a strong system prompt (`CHATBOT_PROMPT` in `patterns/orchestrator-agent/orchestrator_agent.py`) that handles **grounding and guardrails**. Fine-tuning is complementary: it supplies the _tone_ underneath the prompt so on-brand phrasing (naming the FDIC, flagging variable rates, declining internal/out-of-scope asks warmly, never promising returns) is the model's default rather than something the prompt has to enforce turn by turn.

## Layout

```
sagemakerai_assets/
├── README.md                     # this file
├── corpus/                       # raw approved communications (human-readable source)
│   ├── investor-letter-2026-q1.md
│   ├── marketing-brand-voice.md
│   └── compliance-language-library.md
├── data/                         # training-ready datasets
│   ├── train.jsonl               # primary instruction set (chat format)
│   ├── validation.jsonl          # held-out evaluation set
│   ├── investor_letters.jsonl    # domain set — candid, measured voice
│   ├── marketing_copy.jsonl      # domain set — on-brand marketing tone
│   ├── compliance_language.jsonl # domain set — review-passed compliant phrasings
│   └── template.json             # JumpStart instruction prompt/completion template
├── config/
│   └── hyperparameters.json      # LoRA/PEFT instruction-tuning settings
├── pipelines/
│   ├── finetune_pipeline.py      # SageMaker Pipelines definition (preprocess→train→eval→register)
│   └── steps/
│       ├── preprocess.py         # normalize corpora → instruction dataset, split
│       └── evaluate.py           # brand-voice quality gate before registration
└── notebooks/
    └── trinity_voice_finetune.ipynb  # end-to-end walkthrough
```

## The data

Two complementary formats, both derived from the same approved communications:

- **`train.jsonl` / `validation.jsonl`** — chat format (`{"messages": [system, user, assistant]}`), ~40 train / 10 validation examples covering product/rate questions, KYC, out-of-scope declines, confidential-info (DLP) declines, PII-safety redirects, and no-guarantee investing answers.
- **`investor_letters.jsonl`, `marketing_copy.jsonl`, `compliance_language.jsonl`** — native JumpStart instruction format (`{"instruction", "context", "response"}`), teaching the letter's candor, the marketing voice, and the compliant phrasings respectively.

The Pipelines preprocessing step (`steps/preprocess.py`) normalizes **either** format into the JumpStart instruction schema, so you can point training at the chat set, the domain sets, or the blend.

### Editing the data

Keep the voice consistent with `corpus/marketing-brand-voice.md`: composed, plain, no hype, honest about fees and risk. After edits, validate:

```bash
for f in data/*.jsonl; do python3 -c "import json,sys;[json.loads(l) for l in open('$f') if l.strip()];print('$f OK')"; done
```

## Quick start (notebook path)

Run `notebooks/trinity_voice_finetune.ipynb` in **SageMaker Studio** (Python 3 Data Science kernel, a role that can create training jobs, endpoints, and pipelines). It will:

1. Upload the datasets to your default S3 bucket.
2. Fine-tune the JumpStart base model (**Llama 3.1 8B Instruct** by default — swap for any fine-tunable JumpStart `model_id` you have access to).
3. Deploy a managed endpoint and run test questions to hear the voice.
4. Upsert and start the Pipelines version.
5. Emit `trinity_voice_endpoint.json` for wiring into the agent.
6. Delete the endpoint when done.

## Pipeline path (repeatable MLOps)

```bash
cd pipelines
python finetune_pipeline.py \
  --role <SageMakerExecutionRoleArn> \
  --bucket <artifact-bucket> \
  --region us-east-1 \
  --upsert --execute
```

The pipeline runs **preprocess → fine-tune → evaluate → register**. Registration only fires if `metrics.voice_score` from the evaluation step clears the `MinVoiceScore` threshold (default `0.75`), and it registers as `PendingManualApproval` so a human approves the model in the **Model Registry** before deployment.

## No-code path (Canvas)

For a non-ML audience: open **SageMaker Canvas → My Models → Fine-tune foundation model**, create a dataset from `data/train.jsonl`, pick a base model, tune, then use **Analyze** to compare base vs. tuned side by side and **Deploy** or **Add to Model Registry** from the UI. Fastest way to _show_ the before/after.

## Wiring the model into the customer agent

The AI Client Advisor selects its model per request through the existing `requested_model` seam in `patterns/orchestrator-agent/orchestrator_agent.py`. After deployment:

1. Take the endpoint name from `trinity_voice_endpoint.json`.
2. Expose it to the orchestrator as an environment variable (e.g. `VOICE_MODEL_ENDPOINT`) via CDK — **do not hardcode** it (per the repo guidelines).
3. Route the advisor's model calls to a SageMaker model provider targeting that endpoint. Keep `CHATBOT_PROMPT` as the grounding/guardrail layer; the fine-tune supplies tone beneath it.

## Cost & cleanup notes

- Training uses a GPU instance (default `ml.g5.12xlarge`) and bills only for the job's duration.
- The real-time endpoint (`ml.g5.2xlarge`) **bills while it runs** — delete it after the demo (last notebook cell, or from the SageMaker console).
- The Model Registry entry and Pipeline definition are free to keep between demos.

## Responsible AI

This kit follows [AWS Responsible AI](https://aws.amazon.com/ai/responsible-ai/) guidance: the training data models _declining_ confidential and out-of-scope requests, refusing to guarantee returns, and keeping PII out of chat. Fine-tuning reinforces those behaviors; it does not replace the runtime Bedrock Guardrails and DLP already in the demo.
