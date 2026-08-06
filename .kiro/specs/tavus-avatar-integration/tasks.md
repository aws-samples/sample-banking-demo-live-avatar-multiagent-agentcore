# Implementation Plan — Tavus Video Avatar (Pipecat + Nova Sonic)

## Overview

Tasks are ordered so the backend worker and infra land before the frontend wires
to them, and so the demo stays buildable at every step (the Tavus path is
feature-flagged off until the final wiring task). Each task lists the
requirements it satisfies.

## Tasks

- [x]   1. Scaffold the Pipecat + Nova Sonic worker (`patterns/tavus-pipecat-agent/`)
    - Create the package directory with `tavus_pipecat_agent.py`, `Dockerfile`, and `requirements.txt`.
    - `requirements.txt`: `pipecat-ai[aws,aws-nova-sonic,daily,silero,tavus,webrtc]`, `pipecat-ai-small-webrtc-prebuilt`, `aiohttp`, `boto3`, plus the shared `utils` deps (mirror `patterns/livekit-agent/requirements.txt` for versions where they overlap).
    - `Dockerfile`: ARM64, copy `patterns/utils` and `patterns/avatar-agent/persona_prompts.py` + `system_prompt_augmenter.py` into the image, same base and build shape as `patterns/livekit-agent/Dockerfile`.
    - _Requirements: 4.1, 4.5_

- [x]   2. Implement the Nova Sonic pipeline in the worker
    - Build the pipeline in the reference order: `transport.input()` → `context_aggregator.user()` → `user_transcript` → `llm` (`AWSNovaSonicLLMService`, `amazon.nova-2-sonic-v1:0`, region + voice from env) → `agent_transcript` → `tavus` (`TavusVideoService`) → `transport.output()` → `context_aggregator.assistant()`.
    - Port `UserTranscriptForwarder` and `AgentTranscriptForwarder` (Nova Sonic mode: `accumulate=False`) from the reference to emit `{type:"transcript"}` data-channel messages.
    - Configure `TavusVideoService` from env (`TAVUS_API_KEY`, `TAVUS_REPLICA_ID`, `TAVUS_PERSONA_ID`).
    - Add the greeting kickoff (`LLMRunFrame` after the avatar-init delay) bound to both `on_first_participant_joined` (Daily) and `on_client_connected` (SmallWebRTC); cancel the task on `on_client_disconnected`.
    - _Requirements: 4.1, 4.2, 1.1, 1.2, 1.5_

- [x]   3. Port the AgentCore Gateway toolset with tenant isolation into the worker
    - Reuse `utils.auth.get_gateway_access_token`, `utils.ssm.get_ssm_parameter`, and `utils.gateway_tools.{USER_SCOPED_TOOLS, bare_tool_name}`.
    - Register the gateway tools through Pipecat's MCP client, wrapping user-scoped tools so the runtime `user_id` (and `kb_search` pipelines) is merged **over** model-supplied args — a Pipecat-side equivalent of `_ScopedGatewayServer`.
    - Fail closed when `user_id` is empty (log a warning; scoped tools refuse).
    - _Requirements: 4.3, 5.1, 5.2, 5.3_

- [x]   4. Add the overlay tools and persona prompt to the worker
    - Register `show_content`, `show_schedule`, `dismiss_content` as local Pipecat functions emitting `{type:"tool_call"}` data-channel messages; include the Nova Sonic direct `_send_tool_result` handling from the reference (bypasses the aggregator, guards on `_completed_tool_calls`).
    - Apply the persona system prompt via `get_persona_prompt(PERSONA)` and the augmenter.
    - Add the `_credentials_present()` idle guard (mirror `_livekit_creds_present`) so an unpopulated secret idles instead of crash-looping.
    - _Requirements: 4.4, 4.6, 1.1_

- [x]   5. Implement the Cognito-authorized offer endpoint (identity injection)
    - Add a Python Lambda under `lambdas/tavus-offer/` that verifies the caller's Cognito JWT (JWKS), then proxies/starts the worker session passing the verified `sub` in the offer `body`/`requestData` (and `persona`, `voiceId`).
    - Worker reads `user_id` from `requestData` and uses it for tool scoping (task 3).
    - Rate-limit conversation creation per session; enforce max call duration and idle timeout in `PipelineParams`/transport params.
    - _Requirements: 5.4, 6.3, 8.1, 8.4_

- [x]   6. Create the `TavusAvatar` CDK stack (`lib/stacks/tavus-avatar/index.ts`)
    - Secrets Manager secret `/{stack}/tavus` with empty placeholders (`TAVUS_API_KEY`, `TAVUS_REPLICA_ID`, `TAVUS_PERSONA_ID`, `DAILY_API_KEY`); `AwsSolutions-SMG4` suppression.
    - VPC (public subnets, `natGateways: 0`, REJECT flow logs) copied from LiveKit; security group with inbound UDP 10000–65535 for WebRTC media plus egress; `AwsSolutions-EC23` suppression with WebRTC justification.
    - ECS Fargate ARM64 service from `patterns/tavus-pipecat-agent/Dockerfile`; task role grants `bedrock:InvokeModelWithBidirectionalStream` on `models.avatar_sonic`, SSM read `/{stack}/*`, `auth.machineClientSecret` read, tavus secret read; execution role reads tavus secret for env injection.
    - Offer Lambda (task 5) fronted by API Gateway with a Cognito authorizer and WAF association (`auth.regionalWebAclArn`), mirroring the LiveKit token API; CORS on default 4xx/5xx.
    - Expose `offerApiUrl` via SSM param `/{stack}/tavus_offer_url` + `CfnOutput`.
    - _Requirements: 6.2, 6.3, 6.4, 8.1, 8.2, 8.3_

- [x]   7. Wire the stack, feature flag, and config
    - `cdk.json`: add `features.tavus_avatar: true`, a `tavus` context block (`workerCpu`, `workerMemory`, `replicaId?`, `personaId?`, `novaSonicVoiceId`), leave `livekit` block untouched.
    - `lib/stage.ts`: instantiate `TavusAvatar` when `features.tavus_avatar`; add `VITE_TAVUS_OFFER_URL` (and transport-mode var) to `environmentVariables` only when the flag + stack are present; add `addDependency(auth)` and `addDependency(backend)`.
    - _Requirements: 7.1, 7.2, 7.4_

- [x]   8. Remove the photo variant from the frontend
    - Delete `lib/stacks/frontend/app/src/components/avatar/Avatar3DPhoto.ts`.
    - Remove the `photo` case and `Avatar3DPhoto` import from `Avatar3DReactWrapper.tsx`.
    - Delete dead `Avatar3DHuman.ts` and correct `public/avatars/README.md`.
    - Delete `public/avatars/advisor-photo.png`, `-mid.png`, `-open.png`; keep `trinity-advisor.glb` and `headaudio/*`.
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x]   9. Update the variant model (`AvatarVariant.ts`)
    - `AvatarVariantName`: `"photo"` → `"tavus"`.
    - `VARIANT_VOICE_GENDER`: `tavus: null`.
    - Update the file's header comment documenting the (now reduced) naming distinction.
    - _Requirements: 3.5, 10.1_

- [x]   10. Implement the `TavusAvatar.tsx` renderer component
    - Props `{ videoTrack, isSpeaking, className }`; attach `videoTrack` to a `<video autoplay playsinline>`; audio played by the transport client.
    - "Connecting avatar…" placeholder until the track arrives; an "Avatar unavailable" state on error; a track-arrival timeout hint. No WebGL dependency.
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x]   11. Implement the Pipecat transport client (`lib/tavus-pipecat-client/tavusPipecatClient.ts`)
    - Add deps `@pipecat-ai/client-js`, `@pipecat-ai/small-webrtc-transport` (+ Daily transport for cloud); confirm package names/versions against npm.
    - `connect()` posts to `VITE_TAVUS_OFFER_URL` with `Authorization: Bearer <id_token>`, negotiates WebRTC, publishes mic, subscribes to bot audio + **video**.
    - Callbacks matching `AvatarLiveKitClient` plus `onVideoTrack`; parse `{type:"transcript"}`/`{type:"tool_call"}` data-channel messages into `TranscriptUpdate`/`ToolActivity`.
    - `sendText()`, `setMicrophoneEnabled()`, `disconnect()` (idempotent).
    - _Requirements: 1.1, 1.2, 2.1, 6.1_

- [x]   12. Integrate the Tavus path into `AvatarInterface.tsx`
    - Add `avatarVideoTrack` state and `tavusClientRef`.
    - Three-way render branch: `tavus` (+ offer URL set) → `<TavusAvatar>`; `realistic` → `<TalkingHeadAvatar>`; else → `<Avatar3DReactWrapper>`.
    - `connect`/`disconnect`/`startRecording`/`stopRecording` branch on the active transport; enforce single-client and idempotent teardown; guard mid-session variant swaps.
    - Picker: `name: "tavus"`, `Camera` icon, label "Realistic"; render the entry only when `VITE_TAVUS_OFFER_URL` is set.
    - Migrate a persisted `"photo"` localStorage value to `tavus` (or a valid default when the feature is off).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 7.3_

- [x]   13. Tests
    - Python: unit test asserting runtime `user_id` overrides model-supplied values and empty `user_id` fails closed (mirror `test/python/test_pipeline_scope.py`); smoke test the overlay tool schemas/handlers.
    - TypeScript: unit test for the data-channel → `TranscriptUpdate`/`ToolActivity` adapter (mirror `test/typescript/toolArtifacts.test.ts`).
    - CDK: assert the Tavus stack materializes only when `features.tavus_avatar` is true, and that no Tavus/Daily secret is emitted into frontend env.
    - _Requirements: 5.1, 5.2, 6.1, 7.1, 7.2_

- [x]   14. Verification gates
    - Run the frontend build and lint (`npm run build`, `eslint`), Python lint (`ruff`), Jest (`npm test`), pytest (`test:python`), and a `cdk synth` with `features.tavus_avatar` both on and off; fix all failures; confirm no new lint errors and cdk-nag passes with the documented suppressions.
    - _Requirements: 7.2, 10.5_

- [ ]   15. Documentation and messaging
    - DONE: `docs/talking-head-nova-sonic-livekit.md` header describes the pluggable render-stage architecture, naming Tavus (shipped) and HeyGen (example alternative).
    - DONE: `README.demo.md` gains a Tavus Avatar Stack section, the third-party dependency + per-minute cost note, the guidelines-exception note, and pricing line items for Fargate, Tavus, and Daily.
    - DONE: `docs/capabilities-mapping.md` — req 4.1 is now "3P (demonstrated)" via a swappable partner stage; the V3 verification note is updated.
    - PENDING (optional): deeper narration edits in `docs/demo-script.md` / `docs/capabilities-summary.md` — the core vendor-agnostic message is already consistent in the authoritative docs.
    - PENDING (deferred): regenerate `architecture.drawio.png` via `tools/generative-architecture/` (update `research_agent_config.py` first; dry-run before spending the live Bedrock call). Left for a supervised run because it needs a live Bedrock call.
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

## Task Dependency Graph

```json
{
    "waves": [
        { "wave": 1, "tasks": ["1", "8"] },
        { "wave": 2, "tasks": ["2", "9"] },
        { "wave": 3, "tasks": ["3", "5", "10"] },
        { "wave": 4, "tasks": ["4", "6"] },
        { "wave": 5, "tasks": ["7"] },
        { "wave": 6, "tasks": ["11"] },
        { "wave": 7, "tasks": ["12"] },
        { "wave": 8, "tasks": ["13"] },
        { "wave": 9, "tasks": ["14"] },
        { "wave": 10, "tasks": ["15"] }
    ]
}
```

```
1 (worker scaffold)
└─▶ 2 (nova sonic pipeline)
     ├─▶ 3 (gateway toolset + tenant isolation)
     │    └─▶ 4 (overlay tools + persona + idle guard)
     └─▶ 5 (cognito offer endpoint / identity)
          └─▶ 6 (TavusAvatar CDK stack)
               └─▶ 7 (stage wiring + feature flag + cdk.json)

8 (remove photo variant)
└─▶ 9 (AvatarVariant.ts model)
     ├─▶ 10 (TavusAvatar.tsx)
     └─▶ 11 (tavusPipecatClient.ts)   [needs 7 for VITE_TAVUS_OFFER_URL]
          └─▶ 12 (AvatarInterface integration)

3, 5, 11, 6, 7 ─▶ 13 (tests)
everything      ─▶ 14 (verification gates)
12, 7           ─▶ 15 (docs + diagram)
```

Backend track (1→2→3→4, 2→5→6→7) and frontend-removal track (8→9→{10,11}) can
proceed in parallel; they converge at task 12 (frontend integration needs the
offer URL from task 7) and are gated together by tasks 13–15.

## Notes

- The demo remains deployable throughout: `features.tavus_avatar` stays off in
  effect until task 12 renders the picker entry, and the picker hides the Tavus
  entry whenever `VITE_TAVUS_OFFER_URL` is unset (Requirement 7.3).
- Do not modify the LiveKit stack, `patterns/livekit-agent/`, or the existing
  avatar variants — Strategy A keeps them untouched (Requirement 2.2).
- Tavus/Daily credentials are populated manually into Secrets Manager after the
  first deploy, mirroring the LiveKit secret; the worker idles until they exist
  (Requirement 4.6).
- Pipecat and Pipecat JS client package names/versions evolve quickly; verify
  against the reference `requirements.txt` and npm at implementation time.
- Confirm `AWSNovaSonicLLMService` and `TavusVideoService` import paths against
  the installed `pipecat-ai` version rather than assuming the reference pins.
