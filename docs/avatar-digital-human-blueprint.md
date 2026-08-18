# Avatar / Digital Human — Implementation Blueprint

> Scope: this documents the **"Avatar"** experience — the 3D rigged talking‑head
> that is rendered in the browser and driven by real‑time speech. It is **not**
> the "Realistic" (Tavus) server‑rendered video avatar. Every file path below is
> real and current in this repo, so this doc can be used as a build blueprint for
> another project.

---

## 0. Naming — read this first

The UI picker labels and the internal variant names are deliberately crossed, so
be precise when porting:

| Picker label (what the user sees) | Internal variant name (code) | Component                            | This doc? |
| --------------------------------- | ---------------------------- | ------------------------------------ | --------- |
| **Avatar**                        | `realistic`                  | `TalkingHeadAvatar.tsx` (rigged GLB) | ✅ YES    |
| **Realistic**                     | `tavus`                      | `TavusAvatar.tsx` (server video)     | ❌ no     |
| (Robot)                           | `robot`                      | `Avatar3D.ts` via `createAvatar`     | ❌ no     |

Source of truth: `lib/stacks/frontend/app/src/components/avatar/AvatarVariant.ts`.

So "the avatar head, not the realistic one" = internal variant **`realistic`** =
**`TalkingHeadAvatar`**. Throughout this doc, "the Avatar" means that.

---

## 1. What it is, in one paragraph

The Avatar is a **client‑side rendered rigged human head** (three.js + the
`@met4citizen/talkinghead` library) whose mouth is lip‑synced from the **live
audio of an Amazon Nova Sonic 2 speech‑to‑speech model**. The model runs on a
backend voice worker; its audio is streamed to the browser over WebRTC
(LiveKit) or a WebSocket, and the browser taps that audio to drive Oculus
visemes on the mesh via `@met4citizen/headaudio`. The same model can call a
suite of **AgentCore Gateway** tools (knowledge‑base search, web search, image
/ video generation, memory, account lookup, etc.) over MCP. There is no
server‑side video rendering — the face is drawn locally, only voice + tool
events cross the wire.

---

## 2. Architecture at a glance

```
                          Browser (React / Vite)
  ┌───────────────────────────────────────────────────────────────────┐
  │  AvatarInterface.tsx                                                │
  │   ├─ variant = "realistic"  ──► TalkingHeadAvatar.tsx               │
  │   │        three.js + TalkingHead(GLB) + HeadAudio(visemes)         │
  │   ├─ AudioPlayer (24 kHz PCM playback)                              │
  │   ├─ lipSyncAnalyzer.ts (fallback RMS/viseme when no track)         │
  │   └─ transport client (one of):                                    │
  │        • AvatarLiveKitClient  (WebRTC, default)                     │
  │        • AvatarWebSocketClient (SigV4 WS, fallback)                 │
  └───────────────────────────────────────────────────────────────────┘
        │  mic (16 kHz PCM)  ▲  agent audio (24 kHz) + transcript + tool events
        ▼                    │
  ┌───────────── Transport A: LiveKit (default when `livekit` flag on) ──────────┐
  │  LiveKit Cloud (media plane, WebRTC)                                          │
  │        ▲ token minted by:  API GW (Cognito authorizer + WAF) → Token Lambda  │
  │        │                                                                      │
  │  Fargate worker  patterns/livekit-agent/livekit_agent.py                     │
  │     livekit-agents + livekit-plugins-aws  ─►  Amazon Nova Sonic 2            │
  │     MCP toolset  ─►  AgentCore Gateway  (M2M OAuth2)                          │
  └──────────────────────────────────────────────────────────────────────────────┘

  ┌──── Transport B: AgentCore Runtime WebSocket (fallback when `livekit` off) ───┐
  │  BedrockAgentCore::Runtime  patterns/avatar-agent/avatar_agent.py            │
  │     FastAPI + Strands BidiAgent + BidiNovaSonicModel  ─►  Nova Sonic 2       │
  │     MCP client  ─►  AgentCore Gateway  (M2M OAuth2)                           │
  │     Auth: SigV4‑presigned WS (Cognito Identity Pool creds) + id_token in msg │
  └──────────────────────────────────────────────────────────────────────────────┘

  Shared: AgentCore Gateway (MCP) → Lambda tools; Cognito (user pool + M2M);
          Bedrock Knowledge Base (S3 Vectors); SSM params; Secrets Manager.
```

Both backends are deployed at once (they are gated by two independent feature
flags — `avatar` and `livekit`, both `true` in `cdk.json`). The **frontend picks
LiveKit whenever `VITE_LIVEKIT_TOKEN_URL` is set**, otherwise it falls back to the
AgentCore WebSocket runtime. Transport selection lives in
`AvatarInterface.tsx` → `connect()`:

1. `isTavus` (variant `tavus` + `VITE_TAVUS_OFFER_URL`) → Tavus (not this doc)
2. else `VITE_LIVEKIT_TOKEN_URL` set → **LiveKit**
3. else → **AgentCore WebSocket** (`AvatarWebSocketClient` + SigV4)

---

## 3. The "brain" — Amazon Nova Sonic 2

Common to both transports. Speech‑to‑speech (audio in → audio out), so there is
no separate STT/TTS stage and **no word‑level timestamps** — this is why lip‑sync
is audio‑driven (see §4).

| Property            | Value                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Model id            | `amazon.nova-2-sonic-v1:0` (`cdk.json` → `context.models.avatar_sonic`) |
| Tool‑selector model | `amazon.nova-2-lite-v1:0` (`context.models.avatar_tool_selector`)       |
| Audio in            | 16 kHz mono 16‑bit PCM                                                  |
| Audio out           | 24 kHz mono 16‑bit PCM                                                  |
| Inference           | `max_tokens 1024`, `temperature 0.7`, `top_p 0.9` (avatar‑agent)        |
| Turn detection      | endpointing sensitivity HIGH / MEDIUM / LOW                             |
| Session lifetime    | Nova Sonic recycles the session ~every 360 s                            |

Voices are constrained to Nova Sonic 2's catalogue — see
`lib/stacks/frontend/app/src/lib/websocket-client/voice-config.ts` (`VOICES`):
`tiffany`, `matthew` (en‑US), `lupe`/`carlos` (es‑US), `ambre`/`florian` (fr‑FR),
`beatrice`/`lorenzo` (it‑IT), `tina`/`lennart` (de‑DE), `carolina`/`leo` (pt‑BR).

> Voice caveat for the Avatar: on the **LiveKit** transport the voice is **fixed
> for the life of the Fargate task** (`context.livekit.voiceId`, default
> `tiffany`) because rooms are joined before the client sends a preference and
> the token carries no voice. The UI therefore locks the "Avatar" (female GLB)
> to Tiffany. The per‑session voice/language selectors only reach the WebSocket
> runtime.

---

## 4. Frontend — how the head is rendered and lip‑synced

File: `lib/stacks/frontend/app/src/components/avatar/TalkingHeadAvatar.tsx`

### Libraries (all MIT / CC0, self‑hosted — no runtime CDN)

| Purpose                   | Library / asset                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| 3D engine                 | `three` (with `three/addons` GLTFLoader + MeshoptDecoder)                                       |
| Rigged head + render loop | `@met4citizen/talkinghead`                                                                      |
| Audio‑driven visemes      | `@met4citizen/headaudio`                                                                        |
| Avatar mesh               | `/public/avatars/trinity-advisor.glb` — CC0 (MPFB), meshopt + webp compressed, 66 morph targets |
| Viseme worklet            | `/public/headaudio/headworklet.min.mjs`                                                         |
| Viseme model              | `/public/headaudio/model-en-mixed.bin`                                                          |

### Rendering pipeline

1. **Init once** (`useEffect`): patch `GLTFLoader.prototype.meshoptDecoder` to a
   meshopt decoder (the GLB uses meshopt: 3.7 MB vs 16.4 MB with Draco), then
   `new TalkingHead(container, { ttsEndpoint:"/unused-tts", lipsyncModules:[],
cameraView:"head", modelFPS:30 })` and `showAvatar({ url, body:"F",
avatarMood:"neutral" })`. TTS is never called — lip‑sync is audio‑driven.
2. **Viseme detection**: load the HeadAudio worklet into `head.audioCtx`, build
   `new HeadAudio(head.audioCtx, { vadGateActiveDb:-45, vadGateInactiveDb:-65 })`,
   `loadModel(model-en-mixed.bin)`. `headaudio.onvalue(key,value)` writes each
   Oculus viseme value onto `head.mtAvatar[key]` (morph target). HeadAudio's
   `update` is driven from TalkingHead's render loop.
3. **Attach agent audio**: when the transport exposes a `MediaStreamTrack`
   (LiveKit), `head.audioCtx.createMediaStreamSource(new MediaStream([track]))`
   → `connect(headaudio)`. HeadAudio consumes audio and emits visemes but has
   **no audio output**, so tapping the track does not double‑play the voice
   (LiveKit already plays it through its own `<audio>`).
4. **Fallback jaw drive**: the WebSocket transport exposes only an RMS level
   (no track). `TalkingHeadAvatar` then drives a single `jawOpen` morph from
   `audioLevel * 0.7` while `isSpeaking`.

### Lip‑sync analyzer (WebSocket fallback)

File: `lib/stacks/frontend/app/src/components/avatar/lipSyncAnalyzer.ts`

Pure‑JS PCM analyser used only when there is no `MediaStreamTrack`. Decodes
base64 24 kHz PCM chunks and returns `{ rms, shape }`:

- `rms` — amplitude envelope in [0,1] with a noise floor so the mouth shuts on pauses.
- `shape` — a coarse viseme (`ah/oh/ee/oo/mm/ff/th/…`) from zero‑crossing rate +
  low‑band energy (cheap formant proxy, not FFT), with 60 ms hold‑over smoothing.

### Supporting frontend pieces (in `components/avatar/`)

- `AvatarInterface.tsx` — the whole experience: connection lifecycle, transport
  selection, transcript panel, tool cards, media strip, PDF viewer, session
  timer, interrupt count, KB‑pipeline chips, persona/language/voice selectors.
- `AudioPlayer.tsx` — queued 24 kHz PCM playback with volume/mute.
- `AvatarVariant.ts` — variant type + `VARIANT_VOICE_GENDER` (keeps voice
  matched to the on‑screen face).
- `PersonaSelector.tsx`, `LanguageSelector.tsx`, `VoiceSelector.tsx`,
  `KbPipelineChips.tsx`, `AvatarSuggestedPrompts.tsx`, `AvatarTextInput.tsx`.
- `toolArtifacts.ts` / `ToolCallCard.tsx` — render tool output (images, video,
  website, PDF, links) as cards.
- Transport clients:
    - `lib/livekit-client/avatarLiveKitClient.ts` (WebRTC)
    - `lib/websocket-client/client.ts` + `lib/websocket-client/sigv4.ts` (WS)

### Key env vars the frontend reads

`VITE_RUNTIME_ARN_AVATAR`, `VITE_REGION`, `VITE_IDENTITY_POOL_ID`,
`VITE_COGNITO_USER_POOL_ID`, `VITE_LIVEKIT_TOKEN_URL` (presence = use LiveKit),
`VITE_TAVUS_OFFER_URL` (presence = offer Tavus). All injected at deploy time by
`lib/stage.ts` from stack outputs.

---

## 5. Transport A — LiveKit (default, `livekit` flag on)

This is what actually drives the Avatar in the current deploy.

### Infra — `lib/stacks/livekit/index.ts`

- **Media plane**: LiveKit Cloud (free tier), WebRTC. Not deployed by us.
- **Secrets Manager secret** `/{stack}/livekit` — `{url, api_key, api_secret}`.
  Ships with **empty placeholders**; operator must populate post‑deploy:
    ```
    aws secretsmanager put-secret-value --secret-id /<stack>/livekit \
      --secret-string '{"url":"wss://<proj>.livekit.cloud","api_key":"...","api_secret":"..."}'
    ```
    The worker idles (stays healthy, no crash‑loop) until the secret is populated.
- **Fargate worker** (ECS, ARM64, `desiredCount:1`, public subnet, egress‑only
  SG, no NAT). Runs `patterns/livekit-agent`. Task role: `bedrock:InvokeModel*`
  (incl. `InvokeModelWithBidirectionalStream`) on the two avatar models,
  `ssm:GetParameter*` on `/{stack}/*`, read the LiveKit secret + machine client
  secret. CPU 1024 / mem 2048.
- **Token API**: `RestApi` (`/livekit-token`, POST) + **Cognito user‑pool
  authorizer** + **WAF ACL association** → **Token Lambda** (`lambdas/livekit-token`,
  Python 3.13, ARM64). Mints a LiveKit access token whose participant
  `identity` = the caller's Cognito `sub`. URL published as
  `/{stack}/livekit_token_api_url` and surfaced to the frontend as
  `VITE_LIVEKIT_TOKEN_URL`.

### Worker — `patterns/livekit-agent/livekit_agent.py`

- Framework: `livekit-agents` + `livekit-plugins-aws` (`aws.realtime.RealtimeModel`
  = Amazon Nova Sonic 2).
- LiveKit dispatches `entrypoint(ctx)` **once per room**. It:
    1. `await ctx.connect()`, then `_resolve_user_id()` — waits up to 15 s for the
       browser participant and reads its `identity` (the verified Cognito `sub`).
    2. Builds an `AgentSession(llm=RealtimeModel(voice=VOICE_ID),
tools=[_build_gateway_toolset(user_id)])`.
    3. `session.start(room, Agent(instructions=persona_prompt))` then
       `generate_reply(GREETING_INSTRUCTIONS)` so the user is greeted first.
- **Gateway toolset**: `_build_gateway_toolset` reads the gateway URL from SSM
  (`/{stack}/gateway_url`) and a fresh **M2M OAuth2 bearer** via
  `utils.auth.get_gateway_access_token`, then connects an MCP `streamable_http`
  server with a **120 s per‑tool timeout** (Gateway Lambdas run 60–900 s).
- **Tenant isolation**: `_ScopedGatewayServer` wraps every user‑scoped tool in
  `list_tools` and **merges the verified `user_id` over whatever the model
  supplied** (a model‑chosen user id can never reach the Gateway). For
  `kb_search` it also injects `pipelines = (strategy_research, market_research,
services)`. The Strands hooks used on the WebSocket path do **not** run here,
  so this class re‑implements the same contract. (See `docs/kb-isolation.md`.)
- **UI side channels** published on LiveKit data topics:
    - transcripts on `lk.transcription` (both sides, streamed).
    - tool activity on `trb.tool` — `tool_call_started` (with args) and
      `function_tools_executed` (raw output, JSON‑serialized, truncated to 24 KB)
      so the browser can render tool cards / links / images (Nova Sonic speaks a
      URL aloud, it does not emit it verbatim, so this channel is required).
- Env: `MODEL_ID`, `PERSONA` (`friendly`), `VOICE_ID` (`tiffany`), `STACK_NAME`,
  `AWS_REGION`, `GATEWAY_TOOL_TIMEOUT_SECONDS`. LiveKit creds injected as ECS
  `secrets`.

---

## 6. Transport B — AgentCore Runtime WebSocket (fallback, `livekit` flag off)

Deployed whenever the `avatar` flag is on (independent of `livekit`), so it also
exists in the current account as the fallback.

### Infra — `lib/stacks/backend/index.ts` (`if (features.avatar)`)

- `AWS::BedrockAgentCore::Runtime` named `{stack}_avatar`, `PUBLIC` network,
  container from `patterns/avatar-agent/Dockerfile` (ARM64).
- Env: `MODEL_ID = avatar_sonic`, `TOOL_SELECTOR_MODEL_ID = avatar_tool_selector`,
  `PERSONA = friendly`, plus shared `runtimeEnv` (`STACK_NAME`, buckets, region…).
- ARN published to SSM `/{stack}/runtime_arn_avatar` and CFN output; surfaced to
  the frontend as `VITE_RUNTIME_ARN_AVATAR`.

### Runtime — `patterns/avatar-agent/avatar_agent.py`

- Framework: **FastAPI + uvicorn** on port 8080 (pattern from
  `aws-samples/sample-nova-sonic-websocket-agentcore`), with a `/ping` health
  check and a `/ws` WebSocket endpoint.
- Voice engine: **Strands `BidiAgent` + `BidiNovaSonicModel`** — bidirectional
  audio streaming. Audio config: voice, `input_rate 16000`, `output_rate 24000`,
  mono PCM, `audio_type SPEECH`; `turn_detection.endpointingSensitivity`.
- **Auth**: AgentCore Runtime's WS proxy does not forward query params to the
  container, so the Cognito **`id_token` is sent inside the first `sessionStart`
  JSON message**. The `sub` claim is parsed (already verified upstream by the
  Cognito Identity Pool that issued the SigV4 creds). Missing/invalid token →
  post‑accept close `4401`. Frontend presigns the WS URL with SigV4
  (`lib/websocket-client/sigv4.ts`) using Identity‑Pool credentials.
- **Gateway MCP client**: `streamablehttp_client(gateway_url, Bearer <M2M
token>)`, `prefix="gateway"`. Gateway URL from SSM `/{stack}/gateway_url`.
- **Tenant isolation via Strands hooks** (attached at agent creation):
    - `UserScopeHook(user_id)` — force‑injects the verified `sub` into user‑scoped
      tool calls.
    - `PipelineScopeHook(read_filter=…)` — injects the KB read filter from the
      live chip selection; a single‑element mutable holder is updated on
      `kbPipelinesChange` messages so scope changes mid‑session **without**
      rebuilding the agent.
- **System prompt**: `get_persona_prompt(persona)` then
  `augment_system_prompt(prompt, GATEWAY_TOOL_NAMES)` (adds memory / canvas /
  video / data‑sources / profile sections only when those tools are present).

### WebSocket message protocol (frontend ⇄ runtime)

Client → server: `sessionStart {sessionId, idToken, kbPipelines}`, `audio
{audioData(base64 16k PCM)}`, `text {content}`, `kbPipelinesChange {kbPipelines}`,
plus control msgs (`ping`, `personaChange`, `languageChange`, `voiceChange`).

Server → client: `sessionStart`, `audio {audioData(base64 24k PCM)}`, `text
{content, role}`, `toolInvocation {toolName, toolInput}`, `toolResult {toolName,
toolResult, mediaUrl?, mediaType?}`, `pdfPreview {url, filename, page}`,
`connectionRefreshing`, `sessionEnd`, `error {content}`.

---

## 7. Shared backend — AgentCore Gateway (tools), auth, KB

Both transports reach the same tool plane.

### AgentCore Gateway (MCP)

A managed MCP server that exposes Lambda‑backed tools to the model. Tools are
prefixed `gateway_…` and namespaced by target (`target___tool`). The avatar's
known tool set (`GATEWAY_TOOL_NAMES` in `avatar_agent.py`, must stay in sync with
`toolDefs` in `lib/stacks/backend/index.ts`):

| Tool                                                             | Purpose                                                                                                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway_kb_search`                                              | Hybrid search over the Bedrock Knowledge Base (S3 Vectors, Nova multimodal embeddings). User‑scoped; also reaches the user's prior reports/catalogs. |
| `gateway_web_search`                                             | Live web grounding (Nova) with citations.                                                                                                            |
| `gateway_data_sources`                                           | Wikipedia / arXiv lookups.                                                                                                                           |
| `gateway_pdf_generator`                                          | Generate a PDF report → S3 (presigned URL).                                                                                                          |
| `gateway_website_generator`                                      | Generate/update a static site (landing/article/menu).                                                                                                |
| `gateway_extract_pdf_images`                                     | Extract PDF images via AgentCore Code Interpreter.                                                                                                   |
| `gateway_image_generate` / `_history`                            | Image generation (Stability SD3.5) / session history.                                                                                                |
| `gateway_save_memory` / `_recall_memories` / `_analyze_patterns` | AgentCore Memory (episodic / semantic / preference).                                                                                                 |
| `gateway_retrieve_user_profile`                                  | User profile **and the accounts they've opened** (DynamoDB) — the only source for account records.                                                   |
| `gateway_place_order`                                            | Open an account / enroll after KYC (demo intake).                                                                                                    |

Gateway authenticates agents via **Cognito M2M OAuth2 (client‑credentials)**;
tokens are fetched per session (`utils.auth.get_gateway_access_token`) and are
valid ~1 h.

### Identity & isolation

- **Cognito user pool** — human sign‑in (id_token carries `sub`).
- **Cognito Identity Pool** — issues short‑lived AWS creds used to SigV4‑presign
  the WebSocket (Transport B).
- **Cognito M2M app client** — machine credentials for Gateway access.
- Every user‑scoped tool call is stamped with the **verified `sub`** — via
  Strands hooks (WebSocket runtime) or `_ScopedGatewayServer` (LiveKit worker) —
  so one user can never read another's KB view or accounts.

### Knowledge Base

Bedrock Knowledge Base backed by **S3 Vectors** with Nova multimodal embeddings.
KB "pipelines"/views: `strategy_research`, `market_research`, `services`. The
chip bar in the UI selects which views `kb_search` reads; the runtime enforces
the selection (the model does not set it).

### Shared config surfaces

- **SSM Parameter Store**: `/{stack}/gateway_url`, `/{stack}/runtime_arn_avatar`,
  `/{stack}/livekit_token_api_url`, model ids, bucket names.
- **Secrets Manager**: `/{stack}/livekit` (LiveKit Cloud creds), machine client secret.

---

## 8. Personas

File: `patterns/avatar-agent/persona_prompts.py` (used by **both** transports —
the LiveKit worker imports the same module).

- 5 personas via the IS / IS NOT framework: `friendly` (default, "Nova –
  Balanced"), `professional`, `educational`, `creative`, `technical`.
- Every persona shares:
    - `BANK_FACTS` — Trinity Reserve Bank "source of truth" (synthetic): FDIC
      member, Dallas HQ near the TXSE, product set (Everyday Checking, 4.15% APY
      High‑Yield Savings, IRAs, Trinity Managed Portfolios, Private Client), KYC
      requirements, hours, safeguards. The avatar prefers `kb_search` but falls
      back to these facts so a fresh demo never says "I don't know".
    - `TOOL_INSTRUCTIONS` — explicit routing (always call a tool for factual
      questions; kb_search for products/reports; web_search for real‑time; canvas
      for images; `retrieve_user_profile` for the user's own accounts; etc.) plus
      **voice‑output rules** (no URLs/markdown spoken, 1–2 sentences, speak a
      filler before the first tool call, stop on interruption).
- `PERSONA` env var selects the persona (default `friendly`).

---

## 9. Models used

| Role                       | Model id                                   | `cdk.json` key                |
| -------------------------- | ------------------------------------------ | ----------------------------- |
| Voice (speech‑to‑speech)   | `amazon.nova-2-sonic-v1:0`                 | `models.avatar_sonic`         |
| Tool selector (WS runtime) | `amazon.nova-2-lite-v1:0`                  | `models.avatar_tool_selector` |
| KB embeddings              | `amazon.nova-2-multimodal-embeddings-v1:0` | `models.kb_embedding`         |

---

## 10. Feature flags (`cdk.json` → `context.features`)

| Flag                 | Effect on the Avatar                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `avatar: true`       | Deploys the AgentCore WebSocket avatar runtime (Transport B) + sets `VITE_RUNTIME_ARN_AVATAR`.                 |
| `livekit: true`      | Deploys the LiveKit stack (Transport A) + sets `VITE_LIVEKIT_TOKEN_URL`, which makes the frontend use LiveKit. |
| `tavus_avatar: true` | Deploys the Tavus stack + `VITE_TAVUS_OFFER_URL` (the _other_ "Realistic" avatar).                             |

Current repo default: all three `true`, so the **Avatar (TalkingHead) runs on the
LiveKit transport**, with the WebSocket runtime present as fallback.

---

## 11. To replicate in another project (minimum viable Avatar)

1. **Frontend**: React + Vite + three.js. Add `@met4citizen/talkinghead` and
   `@met4citizen/headaudio`. Self‑host a rigged GLB with Oculus‑viseme morph
   targets + the HeadAudio worklet + viseme model under `/public`. Set
   `resolve.dedupe: ["three"]` in `vite.config.ts`. Port `TalkingHeadAvatar.tsx`
   (init → viseme model → attach agent `MediaStreamTrack` → `HeadAudio.onvalue`
   writes morph targets).
2. **Voice backend**: pick one transport.
    - _Fastest path_: LiveKit Cloud + a `livekit-agents` worker using
      `livekit-plugins-aws` `RealtimeModel` (Nova Sonic 2). Mint room tokens from
      a small authorizer‑protected Lambda; set participant `identity` to the
      verified user id.
    - _Self‑contained on AgentCore_: FastAPI `/ws` + Strands `BidiAgent` +
      `BidiNovaSonicModel`; auth via an id_token in the first message; presign the
      WS with SigV4 from a Cognito Identity Pool.
3. **Tools**: expose your tools behind an MCP server (AgentCore Gateway or your
   own) and **inject the verified user id server‑side** on every scoped call —
   never trust a model‑supplied identity.
4. **Audio contract**: 16 kHz PCM in, 24 kHz PCM out; drive visemes from the
   output audio, not from text (Nova Sonic gives no timestamps).
5. **UI side channels**: publish transcript + tool events on a separate channel
   so the browser can show links/images the model only _speaks_ about.

---

## 12. File index (quick reference)

**Frontend** (`lib/stacks/frontend/app/src/`)

- `components/avatar/AvatarInterface.tsx` — orchestration, transport selection
- `components/avatar/TalkingHeadAvatar.tsx` — the Avatar (rigged GLB + visemes)
- `components/avatar/AvatarVariant.ts` — variant names + voice‑gender map
- `components/avatar/lipSyncAnalyzer.ts` — WS fallback viseme analyser
- `components/avatar/AudioPlayer.tsx` — 24 kHz PCM playback
- `components/avatar/persona/voice/language selectors`, `KbPipelineChips.tsx`
- `lib/livekit-client/avatarLiveKitClient.ts` — WebRTC transport
- `lib/websocket-client/client.ts` + `sigv4.ts` — WS transport + presign
- `lib/websocket-client/voice-config.ts` — languages + Nova Sonic voices
- `public/avatars/trinity-advisor.glb`, `public/headaudio/*` — assets

**Backend / infra**

- `patterns/livekit-agent/livekit_agent.py` (+ `Dockerfile`, `requirements.txt`) — LiveKit worker
- `patterns/avatar-agent/avatar_agent.py` — AgentCore WS runtime (BidiAgent + Nova Sonic)
- `patterns/avatar-agent/persona_prompts.py` — personas + bank facts + tool routing (shared)
- `patterns/avatar-agent/system_prompt_augmenter.py` — tool‑aware prompt sections
- `patterns/utils/auth.py`, `gateway_tools.py`, `pipeline_scope.py`, `tool_guard.py`, `ssm.py` — shared helpers
- `lib/stacks/livekit/index.ts` — LiveKit stack (secret, Fargate worker, token API, WAF)
- `lib/stacks/backend/index.ts` — avatar runtime (`if features.avatar`) + Gateway + tools
- `lambdas/livekit-token/` — LiveKit token Lambda
- `lib/stage.ts` — injects `VITE_*` env vars from stack outputs
- `cdk.json` — `context.models.*`, `context.features.*`, `context.livekit.*`

---

_All customer, account, rate and market figures referenced by this experience are
synthetic demonstration data. Assets are MIT / CC0. Generated with this repo as
the reference implementation._
