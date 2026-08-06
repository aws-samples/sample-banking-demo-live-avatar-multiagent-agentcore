# Requirements Document

Tavus Video Avatar (Pipecat + Nova Sonic)

## Introduction

The avatar experience currently offers a browser-rendered "Realistic" variant
(internal name `photo`, `Avatar3DPhoto.ts`) that warps a still photograph per
viseme in a three.js shader. This feature replaces that variant with a
server-rendered, genuinely photoreal **video** avatar produced by Tavus and
delivered to the browser as a live WebRTC track.

The AWS story is preserved: Amazon Nova Sonic (speech-to-speech) on Bedrock
remains the model, the AgentCore Gateway tools and knowledge-base pipelines
remain in force, and per-caller tenant isolation is maintained. Tavus is
integrated as a self-hosted Pipecat pipeline stage running on ECS Fargate in the
customer account, so avatar rendering is pluggable — Tavus is the shipped vendor,
but HeyGen or another provider can replace the single render stage without
touching the model, tools, or frontend.

Only the `photo` / "Realistic" variant is affected. The `realistic` / "Advisor"
GLB and the `robot` / `blob` / `crystal` variants are unchanged.

Design decisions D1–D4 (see design.md) are settled and treated as fixed here:
parallel Pipecat path (LiveKit untouched), the label "Realistic" is kept, a
Cognito-authorized offer endpoint injects the verified caller identity, and the
worker uses Daily in the cloud / SmallWebRTC locally.

## Requirements

### Requirement 1: Server-rendered Tavus video avatar

**User Story:** As a booth visitor, I want the "Realistic" avatar to be a
lifelike talking video of a person, so that the demo feels convincingly human.

#### Acceptance Criteria

1. WHEN a visitor selects the "Realistic" avatar and connects THEN the system SHALL display a live video of the Tavus replica lip-synced to the agent's speech.
2. WHEN the agent speaks THEN the system SHALL play the agent audio in sync with the rendered avatar video.
3. WHILE the avatar video track has not yet arrived THE system SHALL show a "Connecting avatar…" placeholder rather than a black or frozen frame.
4. WHERE WebGL is unavailable in the browser THE Tavus variant SHALL still render, because it uses a plain HTML video element and does not depend on WebGL.
5. WHEN the agent stops speaking THEN the avatar SHALL return to an idle listening state without freezing on the last frame.

### Requirement 2: Transport selection and coexistence

**User Story:** As a developer, I want the Tavus path to run alongside the
existing LiveKit path without disturbing it, so that the working variants keep
functioning.

#### Acceptance Criteria

1. WHEN the active variant is `tavus` AND the Tavus offer endpoint is configured THEN the system SHALL connect using the Pipecat/WebRTC transport client.
2. WHEN the active variant is `realistic`, `robot`, `blob`, or `crystal` THEN the system SHALL connect using the existing LiveKit transport client, unchanged.
3. WHEN the system operates on either transport THEN at most one transport client SHALL be connected at any time.
4. WHEN a visitor switches between the Tavus variant and any other variant mid-session THEN the system SHALL tear down the previously active transport before establishing the other, with no dangling microphone capture or duplicate connections.
5. IF a transport teardown is triggered more than once (rapid toggling) THEN teardown SHALL be idempotent and SHALL NOT leave two live clients.

### Requirement 3: Variant picker and lifecycle

**User Story:** As a visitor, I want to pick the "Realistic" avatar from the same
picker as the other avatars, so that selection is consistent.

#### Acceptance Criteria

1. WHEN the picker is shown AND the Tavus feature is enabled THEN the "Realistic" button SHALL select the Tavus video avatar.
2. WHEN a visitor selects a variant THEN the system SHALL persist the choice to `localStorage["avatar-variant-v2"]`.
3. IF a previously persisted value is `"photo"` (the removed variant) THEN the system SHALL treat it as the Tavus variant if the feature is enabled, otherwise fall back to a valid default, and SHALL NOT render a blank canvas.
4. WHEN a variant is active THEN exactly one avatar renderer SHALL be mounted for it and the others SHALL be unmounted.
5. WHEN the Tavus variant is selected THEN the voice-follows-face logic SHALL be a no-op (the Tavus replica's voice is fixed server-side).

### Requirement 4: Pipecat + Nova Sonic worker preserving the AWS pipeline

**User Story:** As a solutions architect, I want the avatar to keep running on
Amazon Nova Sonic, Bedrock, and the AgentCore Gateway, so that the demo remains
an AWS story with Tavus only rendering the face.

#### Acceptance Criteria

1. WHEN the Tavus worker handles a conversation THEN it SHALL use `AWSNovaSonicLLMService` with model `amazon.nova-2-sonic-v1:0` on Amazon Bedrock as the speech-to-speech engine.
2. WHEN the model produces response audio THEN the worker SHALL route it through the Tavus render stage before the transport output, per the reference pipeline order.
3. WHEN the agent invokes a tool THEN the worker SHALL reach the AgentCore Gateway over MCP using a fresh client-credentials bearer token, reusing this repository's `utils.auth` and `utils.ssm` helpers.
4. WHEN the worker starts a session THEN it SHALL apply the selected persona system prompt from `patterns/avatar-agent/persona_prompts.py`.
5. WHERE the cascaded (Deepgram/Cartesia) pipeline exists in the reference THE worker SHALL NOT include it; only the Nova Sonic pipeline is in scope.
6. WHEN the Tavus credentials secret is unpopulated THEN the worker SHALL idle healthy instead of crash-looping, mirroring the LiveKit worker's credential guard.

### Requirement 5: Tenant isolation on the Tavus path

**User Story:** As a security reviewer, I want every knowledge-base and
user-scoped tool call to be bound to the verified caller, so that one visitor's
data can never leak into another's session.

#### Acceptance Criteria

1. WHEN the agent calls a user-scoped gateway tool THEN the `user_id` sent to the gateway SHALL equal the caller's verified Cognito `sub`, overriding any value the model supplied.
2. IF no verified caller identity is available THEN user-scoped tools SHALL refuse (fail-closed), matching the current LiveKit behaviour.
3. WHEN `kb_search` is called THEN the worker SHALL supply the caller's owned pipelines rather than an archive-mode fan-out.
4. WHEN the caller identity is resolved THEN it SHALL come from the Cognito-authorized offer endpoint (server-verified), not from a client-supplied field.

### Requirement 6: Credential security

**User Story:** As a security reviewer, I want Tavus and Daily credentials to
stay server-side, so that they cannot be extracted from the browser.

#### Acceptance Criteria

1. WHEN the frontend is built and served THEN no Tavus or Daily secret SHALL appear in any bundle, any `VITE_`-prefixed variable, or any payload sent to the browser.
2. WHEN the worker needs Tavus or Daily credentials THEN it SHALL read them from AWS Secrets Manager injected into the Fargate task, never from hardcoded values.
3. WHEN the offer endpoint is exposed THEN it SHALL require Cognito authorization and SHALL be associated with the WAF web ACL, matching the LiveKit token API.
4. WHEN traffic flows between the browser and the worker's control endpoint THEN it SHALL use TLS 1.2 or higher.

### Requirement 7: Feature flag and graceful absence

**User Story:** As an operator, I want the Tavus path to be toggleable, so that
the demo still deploys and runs when Tavus is not configured.

#### Acceptance Criteria

1. WHEN `features.tavus_avatar` is true THEN the CDK app SHALL provision the Tavus stack and inject the offer endpoint URL into the frontend.
2. WHEN `features.tavus_avatar` is false THEN the CDK app SHALL NOT provision the Tavus stack.
3. WHEN the Tavus offer endpoint is not configured in the frontend THEN the picker SHALL omit the "Realistic"/Tavus entry and the application SHALL behave exactly as it does today.
4. WHEN the feature flag state changes THEN no other stack or variant SHALL be affected.

### Requirement 8: Session lifecycle and cost control

**User Story:** As an operator paying Tavus per minute, I want sessions to be
bounded and cleaned up, so that idle or orphaned sessions do not accrue cost.

#### Acceptance Criteria

1. WHEN a conversation is created THEN the worker SHALL enforce a maximum call duration and an idle timeout.
2. WHEN a client disconnects THEN the worker SHALL end the Tavus conversation and cancel the pipeline task.
3. WHEN a new session starts while a prior session for the same worker is still tracked THEN the worker SHALL end the prior conversation before creating a new one.
4. WHEN the offer endpoint receives requests THEN it SHALL rate-limit conversation creation to prevent accidental conversation storms.

### Requirement 9: Vendor-agnostic positioning and documentation

**User Story:** As a presenter, I want the messaging to state that the avatar
renderer is pluggable, so that I can position AWS as compatible with Tavus,
HeyGen, and others.

#### Acceptance Criteria

1. WHEN the architecture and capability docs are updated THEN they SHALL describe the avatar renderer as a swappable pipeline stage, naming Tavus as shipped and HeyGen as an example alternative.
2. WHEN `README.demo.md` is updated THEN it SHALL record the third-party dependency (Tavus, Daily), the per-minute cost, and that this variant is not purely AWS-hosted, noting Tavus and Daily are AWS Marketplace partners.
3. WHEN the architecture diagram is regenerated THEN it SHALL reflect the Pipecat + Nova Sonic + Tavus flow with correct ownership colouring, following the `tools/generative-architecture/` process and its ≤1 live Bedrock call budget.
4. WHEN pricing documentation is updated THEN it SHALL include line items for Tavus, Daily, and the additional Fargate task.

### Requirement 10: Removal and cleanup of the photo variant

**User Story:** As a maintainer, I want the old photo-avatar code and assets
removed cleanly, so that no dead code or unused assets remain.

#### Acceptance Criteria

1. WHEN the change is complete THEN `Avatar3DPhoto.ts`, the `photo` case in `createAvatar()`, and its import SHALL be removed.
2. WHEN the change is complete THEN the photo textures `advisor-photo.png`, `-mid.png`, and `-open.png` SHALL be removed, WHILE `trinity-advisor.glb` and the `headaudio` assets SHALL be retained (the Advisor GLB still uses them).
3. WHEN the change is complete THEN the dead `Avatar3DHuman.ts` file and its stale `public/avatars/README.md` reference SHALL be removed or corrected.
4. WHEN the change is complete THEN `@met4citizen/talkinghead` and `@met4citizen/headaudio` SHALL be retained as dependencies (the Advisor variant still imports them).
5. WHEN the build and lint run after removal THEN there SHALL be no unresolved imports, no unused-symbol errors, and no new lint failures.

## Glossary

- **Tavus** — Third-party service that renders a photoreal talking-head video
  ("replica") from streamed audio. The shipped avatar-render vendor.
- **Replica** — A specific Tavus avatar identity, selected by `replica_id`; its
  appearance and voice are fixed server-side.
- **Pipecat** — Open-source (BSD) real-time voice/video agent orchestration
  framework. Hosts the pipeline stages, including `TavusVideoService`.
- **Nova Sonic** — Amazon Bedrock speech-to-speech model
  (`amazon.nova-2-sonic-v1:0`) that performs STT, LLM reasoning, and TTS in one
  bidirectional stream.
- **AgentCore Gateway** — The MCP endpoint exposing this demo's tools
  (`kb_search`, `web_search`, `website_generator`, `pdf_generator`, etc.).
- **Tenant isolation** — Binding every user-scoped tool call to the verified
  caller so one visitor cannot read another's knowledge-base scope.
- **Daily** — WebRTC transport/relay provider. Used for the browser↔worker leg
  in the cloud and used internally by Tavus for its render relay.
- **SmallWebRTC** — Pipecat's self-hosted WebRTC transport, used for local
  development instead of Daily.
- **Offer endpoint** — The Cognito-authorized control endpoint the browser calls
  to initiate a WebRTC session with the worker; injects the verified caller
  identity.
- **Variant** — A selectable avatar renderer in the picker (`tavus`,
  `realistic`, `robot`, `blob`, `crystal`).
