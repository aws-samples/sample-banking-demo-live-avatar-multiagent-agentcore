"""Trinity Reserve brand-voice fine-tuning pipeline (Amazon SageMaker Pipelines).

Synthetic demonstration asset. This defines a repeatable, managed MLOps flow that:

  1. Preprocesses the approved-communications corpus into an instruction dataset.
  2. Fine-tunes a SageMaker JumpStart foundation model on the bank's voice.
  3. Evaluates the tuned model against a held-out validation set.
  4. Registers the model in the SageMaker Model Registry (gated by a quality
     condition) so a human can approve it before deployment.

The point of the demo is to show the *managed* pieces working together —
Pipelines for orchestration, JumpStart for the base model and training
container, Processing for data prep and evaluation, and the Model Registry for
governance — rather than to ship production ML.

Run `python finetune_pipeline.py --upsert` to create/update the pipeline, or
import `build_pipeline()` from the companion notebook.
"""

from __future__ import annotations

import argparse

import sagemaker
from sagemaker.jumpstart.estimator import JumpStartEstimator
from sagemaker.processing import ProcessingInput, ProcessingOutput, ScriptProcessor
from sagemaker.workflow.condition_step import ConditionStep
from sagemaker.workflow.conditions import ConditionGreaterThanOrEqualTo
from sagemaker.workflow.functions import JsonGet
from sagemaker.workflow.parameters import ParameterFloat, ParameterString
from sagemaker.workflow.pipeline import Pipeline
from sagemaker.workflow.pipeline_context import PipelineSession
from sagemaker.workflow.properties import PropertyFile
from sagemaker.workflow.step_collections import RegisterModel
from sagemaker.workflow.steps import ProcessingStep, TrainingStep

# JumpStart base model. Llama 3.1 8B Instruct is a solid, widely available
# instruction-tuned base for a brand-voice adaptation demo. Swap for any
# fine-tunable JumpStart model_id you have access to.
BASE_MODEL_ID = "meta-textgeneration-llama-3-1-8b-instruct"
BASE_MODEL_VERSION = "*"

PIPELINE_NAME = "trinity-reserve-voice-finetune"
MODEL_PACKAGE_GROUP = "trinity-reserve-voice"


def build_pipeline(
    role: str,
    bucket: str,
    region: str,
    prefix: str = "sagemaker/trinity-voice",
) -> Pipeline:
    """Assemble the fine-tuning pipeline. All infra is created lazily by Pipelines."""
    session = PipelineSession()

    # ---- Parameters (overridable at start-execution time) -----------------
    raw_corpus_uri = ParameterString(
        name="RawCorpusS3Uri",
        default_value=f"s3://{bucket}/{prefix}/corpus/",
    )
    train_instance_type = ParameterString(
        name="TrainInstanceType",
        default_value="ml.g5.12xlarge",
    )
    min_voice_score = ParameterFloat(
        name="MinVoiceScore",
        default_value=0.75,
    )

    sklearn_image = sagemaker.image_uris.retrieve(
        framework="sklearn",
        region=region,
        version="1.2-1",
        instance_type="ml.m5.xlarge",
    )

    # ---- Step 1: preprocess corpus into an instruction dataset ------------
    preprocess = ScriptProcessor(
        image_uri=sklearn_image,
        command=["python3"],
        instance_type="ml.m5.xlarge",
        instance_count=1,
        base_job_name="trinity-voice-preprocess",
        role=role,
        sagemaker_session=session,
    )
    step_preprocess = ProcessingStep(
        name="PreprocessBrandVoiceCorpus",
        processor=preprocess,
        inputs=[ProcessingInput(source=raw_corpus_uri, destination="/opt/ml/processing/input")],
        outputs=[
            ProcessingOutput(output_name="train", source="/opt/ml/processing/train"),
            ProcessingOutput(output_name="validation", source="/opt/ml/processing/validation"),
        ],
        code="steps/preprocess.py",
    )

    # ---- Step 2: fine-tune the JumpStart model ----------------------------
    estimator = JumpStartEstimator(
        model_id=BASE_MODEL_ID,
        model_version=BASE_MODEL_VERSION,
        role=role,
        instance_type=train_instance_type,
        instance_count=1,
        environment={"accept_eula": "true"},
        sagemaker_session=session,
    )
    estimator.set_hyperparameters(
        instruction_tuned="True",
        epoch="3",
        learning_rate="0.0001",
        per_device_train_batch_size="1",
        max_input_length="1024",
        peft_type="lora",
    )
    step_train = TrainingStep(
        name="FineTuneVoiceModel",
        estimator=estimator,
        inputs={
            "training": sagemaker.inputs.TrainingInput(
                s3_data=step_preprocess.properties.ProcessingOutputConfig.Outputs["train"].S3Output.S3Uri,
                content_type="application/jsonlines",
            ),
        },
    )

    # ---- Step 3: evaluate against held-out validation set -----------------
    evaluate = ScriptProcessor(
        image_uri=sklearn_image,
        command=["python3"],
        instance_type="ml.m5.xlarge",
        instance_count=1,
        base_job_name="trinity-voice-evaluate",
        role=role,
        sagemaker_session=session,
    )
    eval_report = PropertyFile(
        name="VoiceEvaluationReport",
        output_name="evaluation",
        path="evaluation.json",
    )
    step_evaluate = ProcessingStep(
        name="EvaluateVoiceModel",
        processor=evaluate,
        inputs=[
            ProcessingInput(
                source=step_train.properties.ModelArtifacts.S3ModelArtifacts,
                destination="/opt/ml/processing/model",
            ),
            ProcessingInput(
                source=step_preprocess.properties.ProcessingOutputConfig.Outputs["validation"].S3Output.S3Uri,
                destination="/opt/ml/processing/validation",
            ),
        ],
        outputs=[ProcessingOutput(output_name="evaluation", source="/opt/ml/processing/evaluation")],
        code="steps/evaluate.py",
        property_files=[eval_report],
    )

    # ---- Step 4: register the model (human-approved before deploy) --------
    step_register = RegisterModel(
        name="RegisterVoiceModel",
        estimator=estimator,
        model_data=step_train.properties.ModelArtifacts.S3ModelArtifacts,
        content_types=["application/json"],
        response_types=["application/json"],
        inference_instances=["ml.g5.2xlarge"],
        transform_instances=["ml.g5.2xlarge"],
        model_package_group_name=MODEL_PACKAGE_GROUP,
        approval_status="PendingManualApproval",
    )

    # Gate registration on a minimum brand-voice score from evaluation.
    step_condition = ConditionStep(
        name="VoiceQualityGate",
        conditions=[
            ConditionGreaterThanOrEqualTo(
                left=JsonGet(
                    step_name=step_evaluate.name,
                    property_file=eval_report,
                    json_path="metrics.voice_score",
                ),
                right=min_voice_score,
            )
        ],
        if_steps=[step_register],
        else_steps=[],
    )

    return Pipeline(
        name=PIPELINE_NAME,
        parameters=[raw_corpus_uri, train_instance_type, min_voice_score],
        steps=[step_preprocess, step_train, step_evaluate, step_condition],
        sagemaker_session=session,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Trinity Reserve voice fine-tuning pipeline")
    parser.add_argument("--role", required=True, help="SageMaker execution role ARN")
    parser.add_argument("--bucket", required=True, help="S3 bucket for pipeline artifacts")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--upsert", action="store_true", help="Create or update the pipeline")
    parser.add_argument("--execute", action="store_true", help="Start an execution after upsert")
    args = parser.parse_args()

    pipeline = build_pipeline(role=args.role, bucket=args.bucket, region=args.region)

    if args.upsert:
        pipeline.upsert(role_arn=args.role)
        print(f"Upserted pipeline: {PIPELINE_NAME}")
    if args.execute:
        execution = pipeline.start()
        print(f"Started execution: {execution.arn}")


if __name__ == "__main__":
    main()
