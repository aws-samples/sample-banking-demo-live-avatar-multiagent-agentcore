"""Preprocessing step for the Trinity Reserve voice pipeline.

Reads the approved-communications JSONL datasets from the processing input,
normalizes every record to the JumpStart instruction schema
({"instruction", "context", "response"}), shuffles, splits into train/validation,
and writes each split plus the shared template.json to the processing outputs.

Synthetic demonstration asset — runs inside a SageMaker Processing container.
"""

from __future__ import annotations

import json
import os
import random

INPUT_DIR = "/opt/ml/processing/input"
TRAIN_DIR = "/opt/ml/processing/train"
VAL_DIR = "/opt/ml/processing/validation"

TEMPLATE = {
    "prompt": (
        "You are the Trinity Reserve Bank AI Client Advisor. Speak with composed, "
        "private-client warmth: plain language, no hype, honest about fees and risk.\n\n"
        "### Instruction:\n{instruction}\n\n### Input:\n{context}\n\n### Response:\n"
    ),
    "completion": "{response}",
}


def _to_instruction_record(obj: dict) -> dict | None:
    """Coerce either a chat record or a native instruction record into the schema."""
    if "instruction" in obj and "response" in obj:
        return {
            "instruction": obj["instruction"],
            "context": obj.get("context", ""),
            "response": obj["response"],
        }
    # Chat format: derive instruction/response from the user/assistant turns.
    messages = obj.get("messages")
    if not messages:
        return None
    user = next((m["content"] for m in messages if m["role"] == "user"), None)
    assistant = next((m["content"] for m in messages if m["role"] == "assistant"), None)
    if user is None or assistant is None:
        return None
    return {"instruction": user, "context": "", "response": assistant}


def _load_all(input_dir: str) -> list[dict]:
    records: list[dict] = []
    for name in sorted(os.listdir(input_dir)):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(input_dir, name), encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                record = _to_instruction_record(json.loads(line))
                if record:
                    records.append(record)
    return records


def _write_split(directory: str, rows: list[dict]) -> None:
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, "train.jsonl"), "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    with open(os.path.join(directory, "template.json"), "w", encoding="utf-8") as handle:
        json.dump(TEMPLATE, handle, indent=2)


def main() -> None:
    records = _load_all(INPUT_DIR)
    random.Random(42).shuffle(records)

    split = max(1, int(len(records) * 0.1))
    validation, train = records[:split], records[split:]

    _write_split(TRAIN_DIR, train)
    _write_split(VAL_DIR, validation)

    print(f"Preprocessed {len(records)} records -> {len(train)} train / {len(validation)} validation")


if __name__ == "__main__":
    main()
