# Design — Tavus Video Avatar (Pipecat + Nova Sonic)

## Overview

Replace the browser-rendered "Realistic" avatar variant (`Avatar3DPhoto.ts`, a
photograph warped per viseme in a three.js shader) with a **server-rendered
photoreal video avatar** produced by Tavus and delivered as a live WebRTC video
track.

The avatar's brain stays on AWS. Amazon Nova Sonic (speech-to-speech, on
Bedrock) remains the model; the AgentCore Gateway tools, knowledge-base
pipelines, and per-caller tenant isolation remain in force. Tavus is added as a
**render-only stage** at the tail of the pipeline — it receives the model's
audio and returns lip-synced video. Because the avatar renderer is isolated
behind a single pipeline stage, the same integration accepts other avatar
vendors (HeyGen, etc.) by swapping that one stage; the demo messaging is
reworded to make this vendor-agnostic point.

This mirrors the end-to-end reference in `gartner-ai-appdev-platforms-avatar-tavus/`
(the `tavus-pipecat-example/` Pipecat path specifically) and the architecture
diagram supplied with the request.

### What this is not

- Not the Tavus hosted CVI (`tavus-avatar/` Next.js path). That path lets Tavus
  orchestrate STT/LLM/TTS and would drop Nova Sonic, Bedrock, and the gateway.
  Rejected per the request.
- Not a change to the `realistic` / "Advisor" GLB, `robot`, `blob`, or
  `crystal` variants. Only `photo` / "Realistic" is replaced.

### Scope boundary (naming)

The picker's internal names are inverted relative to their labels (documented
at `AvatarVariant.ts:34`). The change targets **only**:

| Internal name                | Label       | Today                             | After                       |
| ---------------------------- | ----------- | --------------------------------- | --------------------------- |
| `photo`                      | "Realistic" | `Avatar3DPhoto.ts` (warped photo) | Tavus video track (`tavus`) |
| `realistic`                  | "Advisor"   | rigged GLB via TalkingHead        | unchanged                   |
| `robot` / `blob` / `crystal` | same        | procedural three.js               | unchanged                   |

The variant is renamed `photo` → `tavus` to end the naming inversion for the
one entry we touch.

---

## Key design decision: transport strategy

`TavusVideoService` is a **Pipecat** processor. The current voice backend
(`patterns/livekit-agent/livekit_agent.py`) is built on the **livekit-agents**
SDK — a different orchestration framework — so Tavus cannot be dropped into the
existing worker. A Pipecat worker is required. Two ways to introduce it:

### Strategy A — Parallel Tavus path (recommended)

Keep the LiveKit worker and transport exactly as-is for `realistic` / `robot` /
`blob` / `crystal`. Add a **separate** Pipecat + Tavus worker and a WebRTC
transport used **only** when the visitor selects the `tavus` variant. The picker
switches transports: selecting `tavus` tears down the LiveKit client and
connects the Pipecat client; selecting any other variant does the reverse.

- **Pros:** the working variants are untouched — lowest regression risk;
  directly satisfies "replace only the photo option"; the Pipecat worker can be
  feature-flagged off and the demo still runs.
- **Cons:** two Fargate workers and two frontend transports coexist; the gateway
  MCP toolset + tenant-isolation contract from `livekit_agent.py` must be
  re-implemented in the Pipecat bot (see "Tenant isolation" below).

### Strategy B — Unify on Pipecat

Replace the LiveKit worker and transport entirely. One Pipecat worker serves all
variants; `TavusVideoService` is conditionally included only for `tavus`; the
local variants render from the Pipecat audio track. One worker, one transport,
gateway logic in one place.

- **Pros:** matches the reference exactly; no duplicated Python; single transport.
- **Cons:** large rewrite touching every variant and the whole
  connect/disconnect/mic path; higher regression risk to a working demo; must
  still port tenant isolation.

**Recommendation: Strategy A.** It is the smallest change that satisfies the
request and keeps the shipping demo intact. Strategy B is noted as a future
consolidation once the Tavus path is proven. **The rest of this document assumes
Strategy A.** (Open question O1 confirms this.)

---

## Architecture

Reflects the supplied diagram. The browser holds a single WebRTC connection to
the self-hosted Pipecat worker; Tavus sits upstream of `transport.output()` and
is reached only by the worker, so Tavus/Daily credentials never touch the
browser.

```
USER (browser)                SELF-HOSTED (ECS Fargate, your account)         AWS / TAVUS
─────────────                 ───────────────────────────────────────         ───────────
 mic audio  ─── WebRTC ──▶  transport.input()
                                   │
                                   ▼
                           context_aggregator.user()
                                   │
                                   ▼
                           AWSNovaSonicLLMService  ◀── bidirectional audio ──▶  Bedrock Nova Sonic
                             (STT+LLM+TTS)                                       (amazon.nova-2-sonic-v1:0)
                                   │  tool calls (MCP)  ────────────────────▶   AgentCore Gateway
                                   ▼                                            (kb_search, web_search, …)
                           agent_transcript (data-channel forwarder)
                                   │  response audio frames
                                   ▼
                           TavusVideoService  ─── create conversation ───▶     Tavus API
                                   │           ◀── avatar A/V (Daily relay) ──  Tavus replica render
                                   ▼
 avatar video ◀── WebRTC ── transport.output()
 + audio + data
```

Transport selection in the frontend:

```
avatarVariant === "tavus"  ──▶  TavusPipecatClient  (WebRTC to Pipecat worker; renders remote video track)
otherwise                  ──▶  AvatarLiveKitClient (existing; drives local WebGL avatar from audio track)
```

### CDK stack topology (Strategy A)

```
ApplicationStage (lib/stage.ts)
├── Frontend / FrontendDeployment      (adds VITE_TAVUS_* env vars)
├── Auth
├── Shared
├── Backend                            (unchanged)
├── LiveKit           [flag: livekit]  (unchanged)
└── TavusAvatar       [flag: tavus_avatar]  ← NEW
     ├── Secrets Manager: /{stack}/tavus  (TAVUS_API_KEY, TAVUS_REPLICA_ID, DAILY_API_KEY)
     ├── VPC (public, no NAT) + egress-only SG + WebRTC UDP ingress
     ├── ECS Fargate (ARM64) running patterns/tavus-pipecat-agent
     ├── ALB (Cognito-fronted) OR reuse existing token-auth pattern
     └── SSM param + CfnOutput: worker offer URL
```

---

## Components and Interfaces

### 1. Frontend

#### 1.1 Remove

- `lib/stacks/frontend/app/src/components/avatar/Avatar3DPhoto.ts` (413 lines).
- `photo` case in `Avatar3DReactWrapper.createAvatar()` and the `Avatar3DPhoto`
  import.
- Also delete `Avatar3DHuman.ts` (dead: imported by nothing, needs a missing
  `chef.glb`) and update `public/avatars/README.md` — this is cleanup the change
  makes natural, called out explicitly in requirements so it is not silent.

#### 1.2 `AvatarVariant.ts`

- `AvatarVariantName`: `"photo"` → `"tavus"`. Keep `realistic`, `robot`, `blob`,
  `crystal`.
- `VARIANT_VOICE_GENDER`: replace the `photo: "male"` entry with `tavus: null`
  (Tavus voice/replica is chosen server-side; the client voice selector does not
  reach it, same as the LiveKit path).

#### 1.3 New `TavusAvatar.tsx`

A component that renders the Pipecat worker's **remote video track**, replacing
the WebGL canvas for this variant. Ported from `tavus-demo.tsx` but reduced to
what this app needs (no Daily persona selector, no landing page — the app
already owns connection lifecycle).

Props mirror the other avatar renderers so `AvatarInterface`'s branch stays
symmetric:

```ts
interface TavusAvatarProps {
    videoTrack?: MediaStreamTrack | null; // remote avatar video from Pipecat
    isSpeaking?: boolean; // for a speaking ring / status
    className?: string;
}
```

Rendering: attach `videoTrack` to a `<video autoplay playsinline muted={false}>`
(audio is played by the transport client, see 1.4). Show a "Connecting avatar…"
placeholder until the track arrives, and a WebGL-independent fallback (Tavus is
plain `<video>`, so no WebGL dependency — an improvement over the removed shader
avatar).

#### 1.4 New transport client `lib/tavus-pipecat-client/tavusPipecatClient.ts`

Parallel to `avatarLiveKitClient.ts`. Uses Pipecat's JS client
(`@pipecat-ai/client-js` + `@pipecat-ai/small-webrtc-transport`, or Daily
transport in cloud) to connect to the worker's offer endpoint. Responsibilities:

- `connect()` — negotiate WebRTC with the worker; publish mic; subscribe to the
  bot's audio + **video** tracks.
- Surface callbacks matching the LiveKit client so `AvatarInterface` reuses its
  handlers:
    - `onVideoTrack(track | null)` — NEW; feeds `TavusAvatar`.
    - `onSpeakingChange`, `onConnectionState`, `onTranscript`, `onToolActivity`,
      `onError` — same shapes as `AvatarLiveKitClient`.
- Parse the worker's data-channel messages (`type: "transcript"` and
  `type: "tool_call"` per the reference `UserTranscriptForwarder` /
  `AgentTranscriptForwarder` / tool handlers) into the existing
  `TranscriptUpdate` / `ToolActivity` callbacks so the transcript panel and tool
  cards work unchanged.
- `sendText()`, `setMicrophoneEnabled()`, `disconnect()`.

The data-channel `tool_call` payloads (`show_content` / `show_schedule` /
`dismiss_content`) map onto the existing overlay/website/media side-panel logic
via `extractToolArtifacts` where applicable, or a small adapter.

#### 1.5 `AvatarInterface.tsx`

- State: add `avatarVideoTrack: MediaStreamTrack | null` and a
  `tavusClientRef`.
- Transport gate becomes three-way:
    - `avatarVariant === "tavus"` **and** `VITE_TAVUS_OFFER_URL` set → Pipecat
      client, render `<TavusAvatar videoTrack={avatarVideoTrack} … />`.
    - `avatarVariant === "realistic"` → `<TalkingHeadAvatar …>` (unchanged).
    - otherwise → `<Avatar3DReactWrapper …>` (unchanged).
- `connect()` / `disconnect()` / `startRecording()` / `stopRecording()` branch on
  the active transport. Switching to/from `tavus` mid-session tears down one
  client and stands up the other (guard against double-connect).
- `handleVariantChange`: selecting `tavus` when connected triggers a transport
  swap; the `VARIANT_VOICE_GENDER` voice-follow logic already no-ops for `null`.
- Picker entry: relabel the button — icon stays `Camera`, `name: "tavus"`,
  keep label "Realistic" (visitor-facing wording unchanged) OR "Realistic
  (Video)". Wording is Open Question O2.

#### 1.6 Frontend dependencies

Add: `@pipecat-ai/client-js`, `@pipecat-ai/small-webrtc-transport` (and
`@daily-co/daily-js` if the cloud transport is Daily). Remove: nothing shared —
`@met4citizen/talkinghead` and `@met4citizen/headaudio` stay (Advisor GLB still
uses them). `three` stays (geometric variants). Confirm exact Pipecat client
package names/versions against npm during implementation (they evolve quickly).

### 2. Backend worker — `patterns/tavus-pipecat-agent/`

New Pipecat worker, adapted from `tavus-pipecat-example/tavus-pipecat.py` but
**Nova-Sonic-only** (the cascaded Deepgram/Cartesia path is out of scope — keeps
the third-party surface to Tavus + Daily only) and wired to **this** app's
gateway and personas.

Files:

- `tavus_pipecat_agent.py` — the bot.
- `Dockerfile` — ARM64, mirrors `patterns/livekit-agent/Dockerfile`.
- `requirements.txt` — `pipecat-ai[aws,aws-nova-sonic,daily,silero,tavus,webrtc]`,
  `pipecat-ai-small-webrtc-prebuilt`, `aiohttp`, `boto3`, plus this repo's
  `utils` deps.

Pipeline (Nova Sonic):

```python
Pipeline([
    transport.input(),
    context_aggregator.user(),
    user_transcript,          # UserTranscriptForwarder → data channel
    llm,                      # AWSNovaSonicLLMService (Bedrock)
    agent_transcript,         # AgentTranscriptForwarder → data channel
    tavus,                    # TavusVideoService (render stage)
    transport.output(),
    context_aggregator.assistant(),
])
```

Reused from this repo (not re-invented):

- Persona system prompts: `patterns/avatar-agent/persona_prompts.py`
  (`get_persona_prompt`) and `system_prompt_augmenter.py`.
- Gateway access + SSM: `utils/auth.get_gateway_access_token`,
  `utils/ssm.get_ssm_parameter`.
- Tool scoping contract: `utils/gateway_tools.USER_SCOPED_TOOLS`,
  `bare_tool_name`.

Model/config from env (set by CDK): `MODEL_ID=amazon.nova-2-sonic-v1:0`,
`AWS_REGION`, `STACK_NAME`, `VOICE_ID`, `PERSONA`, `TAVUS_API_KEY`,
`TAVUS_REPLICA_ID`, `TAVUS_PERSONA_ID`, `DAILY_API_KEY` (cloud transport).

#### 2.1 Tenant isolation (critical, must not regress)

The AgentCore path injects the verified Cognito `sub` into every user-scoped
gateway tool call via Strands hooks. `livekit_agent.py` re-implements this for
LiveKit with `_ScopedGatewayServer` (see `docs/kb-isolation.md`). The Pipecat
bot reaches the gateway through **its own** MCP layer
(`pipecat.services.mcp_service.MCPClient` over streamable HTTP), so it must
enforce the same contract:

- Resolve the caller's `user_id` from the verified Cognito identity (see 2.2).
- Register gateway tools with `user_id` (and `pipelines` for `kb_search`) merged
  **over** whatever the model supplied — runtime value always wins.
- With no verified `user_id`, scoped tools must refuse (fail-closed), matching
  today's behaviour.

The `show_content` / `show_schedule` / `dismiss_content` overlay tools from the
reference are additive local tools registered alongside the gateway toolset;
they carry no tenant data.

#### 2.2 Identity on the Pipecat transport

The LiveKit token Lambda stamps the participant `identity` = Cognito `sub`; the
worker reads it off the room. Pipecat's WebRTC/Daily transport has no such token
step by default, so identity must be carried explicitly. Options (decided in
tasks): (a) a Cognito-authorized `/offer` Lambda/endpoint that passes the
verified `sub` into the worker's `body`/`requestData`; (b) the browser sends the
`id_token` in the offer `requestData` and the worker verifies it against the
Cognito JWKS. Option (a) matches the existing token-Lambda pattern and keeps
verification server-side — **preferred**. This is Open Question O3.

### 3. Infrastructure — `lib/stacks/tavus-avatar/index.ts`

New stack, modeled on `lib/stacks/livekit/index.ts` and the reference
`infra/template.yaml`, expressed in CDK (guidelines require CDK, not raw
CloudFormation):

- **Secret** `/{stack}/tavus` with empty placeholders `{ TAVUS_API_KEY,
TAVUS_REPLICA_ID, TAVUS_PERSONA_ID, DAILY_API_KEY }`; operator populates
  post-deploy (same manual-step pattern as the LiveKit secret; documented in
  README). cdk-nag `AwsSolutions-SMG4` suppression as in LiveKit.
- **VPC**: public subnets, `natGateways: 0`, REJECT flow logs — copy LiveKit.
  Security group must additionally allow **inbound UDP 10000–65535** for WebRTC
  media (the reference `ECSSecurityGroup`), unlike the egress-only LiveKit SG.
  cdk-nag `AwsSolutions-EC23` suppression with the WebRTC justification.
- **ECS Fargate** ARM64 service from `patterns/tavus-pipecat-agent/Dockerfile`.
  Task role: `bedrock:InvokeModelWithBidirectionalStream` scoped to
  `models.avatar_sonic`; SSM read `/{stack}/*`; `auth.machineClientSecret`
  read; tavus secret read. Execution role reads the tavus secret for env
  injection. Container env mirrors LiveKit worker + Tavus vars.
- **Client connectivity**: the browser needs to reach the worker's WebRTC offer
  endpoint. Preferred: an ALB (like the reference) behind CloudFront, or a
  Cognito-authorized offer Lambda that proxies to the worker — chosen in tasks
  alongside O3. Whatever is chosen must be WAF-associated
  (`auth.regionalWebAclArn`) to satisfy the guidelines' "protect APIs with WAF".
- Exposes `offerApiUrl` (SSM param `/{stack}/tavus_offer_url` + CfnOutput).

### 4. Stage + config wiring

- `lib/stage.ts`: add `tavus_avatar` feature flag handling; instantiate
  `TavusAvatar` when on; add `VITE_TAVUS_OFFER_URL` (and any client transport
  vars) to `environmentVariables` when the flag + stack are present, mirroring
  the `VITE_LIVEKIT_TOKEN_URL` pattern.
- `cdk.json`:
    - `features.tavus_avatar: true` (new).
    - `models.avatar_sonic` reused (no new model).
    - New `tavus` context block: `{ workerCpu, workerMemory, replicaId?,
personaId?, novaSonicVoiceId }`. Do **not** hardcode the API key —
      Secrets Manager only.
    - Note: `livekit.serverImage/serverCpu/serverMemory` are already-dead config;
      leave untouched (out of scope).

### 5. Removed assets

- `public/avatars/advisor-photo.png`, `-mid.png`, `-open.png` (only
  `Avatar3DPhoto` used them). Keep `trinity-advisor.glb` and `/headaudio/*`
  (Advisor GLB still uses them).
- `docs/headshot-candidates/` source images — the photo-avatar inpaint sources.
  Removal is optional cleanup; flagged in requirements, not silent.

---

## Data Models

The Tavus path introduces no persisted data model. The data-channel message
contract between the Pipecat worker and the browser is the only new schema:

```ts
// Worker → browser, over the WebRTC data channel (from the reference forwarders)
type WorkerDataMessage =
    | { type: "transcript"; role: "user" | "agent"; text: string; final: boolean }
    | {
          type: "tool_call";
          tool: "show_content";
          data: { item: string; url: string; label: string };
      }
    | {
          type: "tool_call";
          tool: "show_schedule";
          data: { title: string; columns: ScheduleColumn[] };
      }
    | { type: "tool_call"; tool: "dismiss_content"; data: Record<string, never> };

interface ScheduleColumn {
    title?: string;
    markdown_table: string;
}
```

The client adapter (§1.4) maps `transcript` → `TranscriptUpdate` and
`tool_call` → `ToolActivity` / overlay state, the same shapes the LiveKit path
already produces, so no downstream transcript/tool-card types change.

Tavus session state (`conversation_id`, replica/room) is held **only** inside
the worker's `TavusVideoService`; the browser never sees it.

## Data flow — one visitor turn (tavus variant)

1. Browser publishes mic over WebRTC to `transport.input()`.
2. `AWSNovaSonicLLMService` streams audio bidirectionally with Bedrock Nova
   Sonic; emits user + agent transcripts and any tool calls.
3. Tool calls hit the AgentCore Gateway over MCP with the caller's `user_id`
   injected (tenant isolation preserved); overlay tools emit data-channel
   messages.
4. `agent_transcript` forwards agent text to the browser data channel; the
   transcript panel and tool cards render as they do on the LiveKit path.
5. Response audio flows into `TavusVideoService`, which drives the Tavus replica
   and returns lip-synced avatar video (over Tavus's Daily relay, worker-side).
6. `transport.output()` sends avatar **video + audio** to the browser;
   `TavusAvatar` attaches the video track; the transport client plays the audio.

---

## Security

- Tavus/Daily credentials live only in Secrets Manager and are injected into the
  Fargate task; they never reach the browser (the browser talks only to the
  worker). This is the key security property of the Pipecat path over the hosted
  CVI path.
- The worker's offer/connect endpoint is Cognito-authorized and WAF-associated,
  matching the existing LiveKit token API.
- Tenant isolation (§2.1) is a hard requirement — a regression here would let one
  visitor's KB scope leak into another's session. Covered by a dedicated
  requirement and test.
- TLS 1.2+ enforced end-to-end (CloudFront / ALB), per guidelines.
- WebRTC UDP ingress is scoped to the media port range; justified via cdk-nag
  suppression with the same rationale as the reference.

## Cost & guidelines exception

- New third-party paid dependencies on the Nova Sonic path: **Tavus** (per-minute
  avatar rendering) and **Daily** (cloud WebRTC relay). No Deepgram/Cartesia —
  the cascaded path is excluded.
- This widens the existing "external managed media plane" exception already set
  by the LiveKit Cloud dependency. `README.demo.md` and the guidelines note must
  record: the demo is no longer purely AWS-hosted on this variant, Tavus/Daily
  are AWS Marketplace partners, and per-minute billing applies.
- Add per-service pricing lines (Tavus, Daily, Fargate task) to the README
  pricing section, matching the existing format.

## Vendor-agnostic positioning (HeyGen, etc.)

Because the avatar renderer is a single Pipecat stage (`TavusVideoService`)
downstream of the AWS-owned pipeline, swapping vendors means swapping that one
stage (`HeyGenVideoService`, etc.) with no change to Nova Sonic, the gateway, or
the frontend video rendering. Docs/messaging are reworded from "Tavus avatar" to
"pluggable photoreal video avatar (Tavus shown; HeyGen and others supported via
the same pipeline stage)". The `docs/talking-head-nova-sonic-livekit.md` guide
and capability docs are updated to reflect the render-stage abstraction.

## Correctness Properties

### Property 1: Tenant isolation holds on the Tavus path

For any user-scoped gateway tool call, the `user_id` sent to the gateway equals
the caller's verified Cognito `sub`, regardless of what the model supplied. With
no verified identity, scoped tools refuse (fail-closed). Matches
`livekit_agent.py`.

**Validates: Requirements 5.1, 5.2**

### Property 2: Credentials never reach the browser

No Tavus or Daily secret appears in any frontend bundle, any `VITE_`-prefixed
env var, or any network payload to the browser.

**Validates: Requirements 6.1**

### Property 3: Variant isolation

Selecting `tavus` never tears down or degrades the `realistic` / `robot` /
`blob` / `crystal` render paths, and vice versa; at most one transport client is
connected at a time.

**Validates: Requirements 2.3, 3.4**

### Property 4: Graceful absence

With `features.tavus_avatar` off (or `VITE_TAVUS_OFFER_URL` unset), the picker
omits the Tavus entry and the app behaves exactly as today.

**Validates: Requirements 7.3**

## Error Handling

- **Worker unreachable / offer fails:** the client surfaces a connection error
  through the existing `onError`/`onConnectionState` path; the picker allows
  falling back to another variant. No unhandled promise rejections.
- **Tavus API failure (quota, bad replica, API down):** the worker logs and the
  session ends cleanly; the browser shows "Avatar unavailable" rather than a
  frozen frame. Voice/transcript should still be recoverable by switching
  variants.
- **Video track never arrives:** `TavusAvatar` holds its "Connecting avatar…"
  placeholder rather than rendering a black frame; a timeout surfaces a
  retry/fallback hint.
- **Missing identity:** scoped tools fail closed (per Correctness Properties);
  the avatar continues but KB-scoped answers are refused, matching today.
- **Secret not yet populated:** the worker idles healthy (mirror
  `_livekit_creds_present()` guard) instead of crash-looping the ECS service.
- **Mid-session variant swap:** transport teardown is idempotent and guarded so
  a rapid toggle cannot leave two live clients or a dangling mic.

## Testing Strategy

- **Python:** unit test for the Pipecat bot's tenant-isolation wrapper (mirror
  `test/python/test_pipeline_scope.py` intent) — asserts runtime `user_id`
  overrides model-supplied values and that a missing `user_id` fails closed.
  Tool-schema/handler smoke test for `show_content`/`show_schedule`/`dismiss`.
- **TypeScript:** unit test for the data-channel → `TranscriptUpdate` /
  `ToolActivity` adapter in the Pipecat client (mirror
  `test/typescript/toolArtifacts.test.ts`).
- **CDK:** synth must pass cdk-nag with documented suppressions; assert the
  Tavus stack only materializes when `features.tavus_avatar` is true.
- **Build gates:** `npm run build`, `npm run lint`, `eslint`, `ruff`, and a CDK
  synth all pass. No new lint errors (guidelines).
- **Manual:** end-to-end at the kiosk — select "Realistic", confirm live avatar
  video, working transcript, working overlays, and that other variants still
  connect over LiveKit.

## Resolved decisions

- **D1 (was O1) — Transport strategy: Strategy A.** Add a parallel Pipecat+Tavus
  path; the existing LiveKit transport and worker are left untouched and keep
  serving `realistic` / `robot` / `blob` / `crystal`. Strategy B (full
  migration) is deferred.
- **D2 (was O2) — Picker label: keep "Realistic".** Visitor-facing wording is
  unchanged; only the internal variant name changes (`photo` → `tavus`) and the
  render path changes to Tavus video.
- **D3 (was O3) — Identity: Cognito-authorized offer endpoint.** A Lambda
  fronting the worker verifies the caller's Cognito JWT and injects the verified
  `sub` into the worker's offer `body`/`requestData`. The browser never supplies
  its own `user_id`. Mirrors the existing LiveKit token-Lambda pattern and keeps
  verification server-side.
- **D4 (was O4) — Transport: Daily in the cloud, SmallWebRTC locally.** The
  deployed worker uses the Daily transport (`DAILY_API_KEY` from Secrets
  Manager); local dev uses the prebuilt SmallWebRTC transport (no Daily
  dependency). Selected by an env var as in the reference. Tavus uses Daily
  internally regardless, so this adds no new vendor beyond what Tavus requires.

```

```
