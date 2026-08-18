"""Evaluation step for the Trinity Reserve voice pipeline.

Scores the fine-tuned model against the held-out validation set on a small set
of brand-voice heuristics and writes evaluation.json. The pipeline's condition
step reads metrics.voice_score to decide whether to register the model.

This is a lightweight, dependency-free proxy for a real LLM-as-judge or human
evaluation. It rewards on-brand behavior (declining out-of-scope and
confidential asks, naming fees/risk, brevity) and penalizes hype language.

Synthetic demonstration asset — runs inside a SageMaker Processing container.
In a full run you would batch-invoke the tuned model to produce predictions;
here we score the reference responses so the pipeline is runnable end to end
without a live endpoint.
"""

from __future__ import annotations

import json
import os

VAL_DIR = "/opt/ml/processing/validation"
OUT_DIR = "/opt/ml/processing/evaluation"

HYPE_TERMS = ("best ever", "unbeatable", "guaranteed return", "risk-free", "act now", "hurry")
ON_BRAND_SIGNALS = ("fdic", "variable", "risk", "no monthly fee", "apy", "can't share", "verification")


def _score_response(text: str) -> float:
    lowered = text.lower()
    score = 0.5
    if any(signal in lowered for signal in ON_BRAND_SIGNALS):
        score += 0.3
    if len(text.split()) <= 60:  # brevity is on-brand
        score += 0.2
    if any(term in lowered for term in HYPE_TERMS):
        score -= 0.5
    return max(0.0, min(1.0, score))


def _load_validation() -> list[str]:
    responses: list[str] = []
    for name in os.listdir(VAL_DIR):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(VAL_DIR, name), encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if "response" in obj:
                    responses.append(obj["response"])
                elif "messages" in obj:
                    assistant = next((m["content"] for m in obj["messages"] if m["role"] == "assistant"), "")
                    responses.append(assistant)
    return responses


def main() -> None:
    responses = _load_validation()
    scores = [_score_response(r) for r in responses if r]
    voice_score = round(sum(scores) / len(scores), 4) if scores else 0.0

    report = {
        "metrics": {
            "voice_score": voice_score,
            "samples_evaluated": len(scores),
        },
        "notes": "Heuristic brand-voice proxy. Replace with LLM-as-judge or human review for production.",
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "evaluation.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    print(f"voice_score={voice_score} over {len(scores)} samples")


if __name__ == "__main__":
    main()
