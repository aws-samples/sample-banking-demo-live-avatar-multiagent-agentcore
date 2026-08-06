# Photorealistic Talking Head + Nova Sonic 2 + LiveKit — Implementation Guide

> **Update — the "Realistic" avatar is now a pluggable server-rendered video.**
> The photoreal option in the picker (previously a photograph warped in a
> three.js shader, internal name `photo`) has been replaced by a server-rendered
> video avatar produced by an avatar-rendering vendor and streamed to the browser
> over WebRTC. See [`docs/tavus-avatar-integration`](../.kiro/specs/tavus-avatar-integration/design.md)
> for the full design. Key points:
>
> - **The AWS pipeline is unchanged in spirit.** Amazon Nova Sonic (speech-to-speech,
>   on Bedrock) is still the model, and the AgentCore Gateway tools and per-caller
>   tenant isolation still apply. A self-hosted [Pipecat](https://pipecat.ai)
>   worker on ECS Fargate orchestrates the pipeline.
> - **The avatar renderer is one swappable pipeline stage.** [Tavus](https://tavus.io)
>   is the shipped vendor (`TavusVideoService`); it sits downstream of the model
>   and tools, so swapping in [HeyGen](https://heygen.com) or another provider is
>   a one-stage change with no impact on Nova Sonic, the gateway, or the frontend
>   video element. Messaging should present AWS as vendor-agnostic here.
> - **This runs alongside, not instead of, the LiveKit path below.** The Advisor
>   GLB and the geometric avatars still use the LiveKit transport documented in
>   this guide. Only the "Realistic" entry uses the Tavus/Pipecat transport, and
>   only when the `tavus_avatar` flag is on. The rest of this document remains the
>   reference for the LiveKit path and the rigged-GLB Advisor avatar.

A reproducible recipe for a lip-synced, photorealistic 3D avatar that speaks with
**Amazon Nova Sonic 2** over **LiveKit** WebRTC. Written to be portable: nothing
here is specific to the Trinity Reserve Bank demo beyond names.

Everything below was verified end-to-end in a headless browser before it was
integrated (see [§10 Verification](#10-verification-recipe)).

---

## 1. Architecture

```
Browser                                   AWS
┌──────────────────────────────┐          ┌────────────────────────────────┐
│ 1. POST /livekit-token       │─────────▶│ API Gateway + Cognito authz    │
│    (Cognito id_token)        │          │   └─▶ Lambda: mint room token  │
│ ◀── { serverUrl, token,      │◀─────────│       (identity = Cognito sub) │
│       roomName }             │          └────────────────────────────────┘
│                              │
│ 2. room.connect(url, token)  │          LiveKit Cloud (media plane)
│    publish microphone        │◀────────▶┌────────────────────────────────┐
│                              │  WebRTC  │  SFU / room                    │
│ 3. RoomEvent.TrackSubscribed │          └────────────────────────────────┘
│    → agent audio track       │                        ▲
└──────────────────────────────┘                        │ WebRTC (dials out)
        │                                    ┌──────────┴─────────────────┐
        │ MediaStreamTrack                   │ ECS Fargate: agent worker  │
        ▼                                    │  LiveKit Agents            │
┌──────────────────────────────┐             │   + AWS realtime plugin    │
│ AudioContext                 │             │     → Nova Sonic 2 (Bedrock)│
│  ├─▶ <audio> (playback)      │             │   + MCP tools (optional)   │
│  └─▶ HeadAudio worklet       │             └────────────────────────────┘
│       → Oculus visemes       │
│       → TalkingHead GLB      │
└──────────────────────────────┘
```

Two independent consumers of the same audio track:

1. **Playback** — LiveKit's `track.attach()` creates an `<audio>` element.
2. **Lip-sync** — a `MediaStreamSource` feeds the HeadAudio worklet.

HeadAudio has an audio **input but no output**, so tapping the track a second
time cannot double-play the voice. This is the single most important detail to
get right.

---

## 2. Why these components

| Decision                                 | Reason                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Audio-driven** lip-sync (HeadAudio)    | Nova Sonic streams speech **audio**, not word-level timestamps. TalkingHead's default lip-sync is _text-driven_ and needs per-word timings, so it does not apply. HeadAudio classifies visemes from the signal itself (MFCC + Mahalanobis), needing no transcript. |
| **LiveKit Cloud** for media              | Self-hosting was evaluated and rejected — see below.                                                                                                                                                                                                               |
| **LiveKit Agents + AWS realtime plugin** | `RealtimeModel()` defaults to `amazon.nova-2-sonic-v1:0` as of `livekit-plugins-aws` 1.5, so Nova Sonic 2 needs no extra config.                                                                                                                                   |
| **CC0 avatar (MPFB)**                    | The popular example avatars are **non-commercial** (see §4).                                                                                                                                                                                                       |

### Why not self-host the LiveKit server

A browser on an HTTPS page requires secure `wss://` for LiveKit signaling. A
public ACM certificate **cannot** be issued for an `*.amazonaws.com` NLB/ALB
hostname, so self-hosting requires a **custom domain you own**. Additionally,
WebRTC UDP media behind an NLB needs static per-AZ Elastic IPs plus
`rtc.node_ip` mapping; forcing media over TCP/TLS instead discards the quality
advantage that motivated WebRTC in the first place.

If you must stay 100% in-account, budget for a domain + DNS + WebRTC tuning, and
prefer EC2 with an Elastic IP over Fargate for the media server.

---

## 3. Dependencies (exact, verified)

**Frontend**

```jsonc
{
    "@met4citizen/talkinghead": "1.7.0", // MIT
    "@met4citizen/headaudio": "0.1.0", // MIT
    "livekit-client": "^2.15.7", // resolved 2.21.0, Apache-2.0
    "three": "0.180.0", // pinned: TalkingHead requires ^0.180
}
```

> **Pin `three` to 0.180.x.** TalkingHead declares `three` as a _dependency_
> (not a peer), so a mismatched root version makes npm install a **nested second
> copy** — which breaks the loader patch in §5 and doubles bundle size.

**Agent worker (Python)**

```
livekit-agents[mcp]~=1.5          # the [mcp] extra is REQUIRED if you use MCP tools
livekit-plugins-aws[realtime]~=1.5  # provides Nova Sonic 2
boto3>=1.34.0
```

**Token Lambda (Python)**

```
livekit-api~=1.0
```

---

## 4. The avatar asset (read this before picking one)

### Licensing — the trap

TalkingHead's repo ships six example avatars. Most are **non-commercial** and
unusable in a commercial or marketing context:

| Avatar                           | License                                  | Commercial use |
| -------------------------------- | ---------------------------------------- | -------------- |
| `avaturn.glb`, `avatarsdk.glb`   | Vendor non-commercial                    | ❌             |
| `brunette.glb`, `brunette-t.glb` | CC BY-NC 4.0 (Ready Player Me free tier) | ❌             |
| `vroid.glb`                      | VRoid, permissive but not CC0            | ⚠️ check terms |
| **`mpfb.glb`**                   | **CC0 (public domain)**                  | ✅             |

The realistic avatars shown in most TalkingHead screenshots are the NC ones.
**`mpfb.glb` is the only clean choice** — a realistic human generated with the
MPFB Blender extension.

### Required rig/blend shapes

A compatible GLB must have:

- **Mixamo-compatible rig**, root node named `Armature` (TalkingHead's default
  `modelRoot`)
- **Oculus visemes** (15): `viseme_sil`, `viseme_PP`, `viseme_FF`, `viseme_TH`,
  `viseme_DD`, `viseme_kk`, `viseme_CH`, `viseme_SS`, `viseme_nn`, `viseme_RR`,
  `viseme_aa`, `viseme_E`, `viseme_I`, `viseme_O`, `viseme_U`
- **ARKit blend shapes** (52): `jawOpen`, `mouthClose`, `eyeBlinkLeft`,
  `browInnerUp`, …

Verify _before_ you build anything (parses the GLB JSON chunk directly, no deps):

```python
import json, struct
p = "avatar.glb"
with open(p, "rb") as f:
    struct.unpack("<III", f.read(12))          # header
    clen, _ = struct.unpack("<II", f.read(8))  # JSON chunk length
    g = json.loads(f.read(clen).decode())
names = set()
for m in g.get("meshes", []):
    names.update((m.get("extras") or {}).get("targetNames") or [])
nodes = [n.get("name") for n in g.get("nodes", [])]
print("morphs:", len(names))
print("visemes:", sorted(n for n in names if n.startswith("viseme_")))
print("Armature:", "Armature" in nodes)
print("jawOpen:", "jawOpen" in names)
```

### Compression — 36.8 MB → 3.7 MB

The raw MPFB avatar is 36.8 MB, dominated by morph-target data (the eyelash and
eyebrow meshes alone carry ~22 MB because they each hold all 66 morph targets).

**Do NOT use `gltf-transform optimize`.** Its `flatten`/`join` passes destroy the
`Armature` node and the rig. Use only texture + geometry compression:

```bash
npx @gltf-transform/cli webp    avatar.glb    _tmp.glb   # 36.8 MB → 18.7 MB
npx @gltf-transform/cli meshopt _tmp.glb      avatar-opt.glb  # → 3.7 MB
rm _tmp.glb
```

Then **re-run the verification script above** and confirm morphs, visemes, and
`Armature` all survived.

Compression comparison (same avatar):

| Pipeline                | Size       | Rig intact           |
| ----------------------- | ---------- | -------------------- |
| none                    | 36.8 MB    | ✅                   |
| `webp` only             | 18.7 MB    | ✅                   |
| `webp` + `draco`        | 16.4 MB    | ✅                   |
| `webp` + `meshopt`      | **3.7 MB** | ✅                   |
| `optimize` (all passes) | 3.4 MB     | ❌ **Armature lost** |

Draco compresses dense morph targets poorly — meshopt is 4× better here.

---

## 5. The meshopt gotcha (and the fix)

TalkingHead's README claims meshopt support "by default". **It does not have
it** — the source only wires a `DRACOLoader` (`dracoEnabled` /
`dracoDecoderPath`). Loading a meshopt GLB fails with:

```
THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files
```

TalkingHead creates its `GLTFLoader` internally, so you cannot pass a decoder
in. But it imports from `three/addons/loaders/GLTFLoader.js` — the same
specifier your app uses — so the **class object is shared** and can be patched:

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// A plain `GLTFLoader.prototype.meshoptDecoder = MeshoptDecoder` does NOT work:
// GLTFLoader's constructor runs `this.meshoptDecoder = null`, creating an own
// property that shadows the prototype. An accessor with a no-op setter absorbs
// that assignment and always reports the decoder.
Object.defineProperty(GLTFLoader.prototype, "meshoptDecoder", {
    get: () => MeshoptDecoder,
    set: () => {},
    configurable: true,
});
```

Two requirements for this to hold:

1. **One copy of `three`.** Add to `vite.config.ts`:
    ```ts
    resolve: {
        dedupe: ["three"];
    }
    ```
2. **Verify in the production bundle**, not just dev — Vite's dep pre-bundling
   and Rollup resolve differently:
    ```bash
    grep -o "setMeshoptDecoder must be called" dist/assets/*.js | wc -l   # must be 1
    ```

`three/addons/*` resolves natively (three's `package.json` maps
`"./addons/*" → "./examples/jsm/*"`), so no alias is needed.

_Alternative if you'd rather not patch:_ ship the Draco build (16.4 MB) and set
`dracoEnabled: true` + a self-hosted `dracoDecoderPath` (the default points at a
Google CDN).

---

## 6. Frontend implementation

### 6.1 Static assets (self-hosted — no CDN)

```
public/
├── avatars/advisor.glb                 # 3.7 MB, meshopt+webp, CC0
└── headaudio/
    ├── headworklet.min.mjs             # from node_modules/@met4citizen/headaudio/dist/
    └── model-en-mixed.bin              # 14 kB pre-trained viseme model
```

```bash
cp node_modules/@met4citizen/headaudio/dist/headworklet.min.mjs public/headaudio/
cp node_modules/@met4citizen/headaudio/dist/model-en-mixed.bin   public/headaudio/
```

> Exclude `*.min.mjs` from ESLint, or it will lint the minified worklet.

### 6.2 Avatar component

```ts
import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/modules/headaudio.mjs";
// (+ the GLTFLoader meshopt patch from §5, executed once before showAvatar)

// 1. Scene + avatar
const head = new TalkingHead(containerEl, {
    ttsEndpoint: "/unused-tts", // never called; lip-sync is audio-driven
    lipsyncModules: [], // no text-driven modules needed
    cameraView: "head",
    modelFPS: 30,
});
await head.showAvatar({ url: "/avatars/advisor.glb", body: "F", avatarMood: "neutral" });

// 2. Viseme detection
await head.audioCtx.audioWorklet.addModule("/headaudio/headworklet.min.mjs");
const headaudio = new HeadAudio(head.audioCtx, {
    parameterData: { vadGateActiveDb: -45, vadGateInactiveDb: -65 },
});
await headaudio.loadModel("/headaudio/model-en-mixed.bin");

// 3. Visemes → blend shapes
headaudio.onvalue = (key, value) => {
    const mt = head.mtAvatar[key];
    if (mt) Object.assign(mt, { newvalue: value, needsUpdate: true });
};
// Advance HeadAudio's easing from TalkingHead's render loop.
head.opt.update = headaudio.update.bind(headaudio);

// 4. LiveKit audio track → HeadAudio  (the crux)
await head.audioCtx.resume(); // autoplay policy; safe after a user gesture
const src = head.audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
src.connect(headaudio); // no .connect(destination) → no double audio
```

Notes:

- `head.opt.update` is read every frame, so assigning it **after** `showAvatar()`
  is fine.
- The constructor starts the render loop; you don't call `start()`.
- Exports are `TalkingHead` and `HeadAudio` (the HeadAudio README says
  `HeadAudioNode` in one snippet — that is wrong).
- Neither package ships TypeScript types; write a small `.d.ts` declaring only
  what you use (`mtAvatar`, `audioCtx`, `opt`, `showAvatar`, `loadModel`,
  `onvalue`, `update`).

### 6.3 LiveKit client — surfacing the track

```ts
import { Room, RoomEvent, Track } from "livekit-client";

const { serverUrl, token } = await fetchToken(); // §7.2
const room = new Room();

room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) return;
    // (a) playback
    const el = track.attach();
    el.autoplay = true;
    el.style.display = "none";
    document.body.appendChild(el);
    // (b) lip-sync — hand the raw track to the avatar
    onAudioTrack(track.mediaStreamTrack);
});

await room.connect(serverUrl, token);
await room.localParticipant.setMicrophoneEnabled(true); // publish mic
```

LiveKit captures and encodes the microphone itself — **delete any custom
AudioWorklet mic-capture path** you had for a raw-PCM WebSocket transport.

### 6.4 Always guard WebGL

A disabled-GPU browser makes `new THREE.WebGLRenderer()` throw. Uncaught, that
blanks the whole page. Wrap avatar init in `try/catch` and render a fallback —
voice should survive a missing avatar.

---

## 7. Backend implementation

### 7.1 Agent worker (ECS Fargate, ARM64)

```python
from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, mcp
from livekit.plugins import aws

async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    session = AgentSession(
        llm=aws.realtime.RealtimeModel(),   # defaults to amazon.nova-2-sonic-v1:0
        tools=[                             # optional: MCP tools
            mcp.MCPToolset(
                id="gateway",
                mcp_server=mcp.MCPServerHTTP(
                    gateway_url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    transport_type="streamable_http",
                ),
            )
        ],
    )
    await session.start(room=ctx.room, agent=Agent(instructions=SYSTEM_PROMPT))
    await session.generate_reply(instructions="Greet the user in one sentence.")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
```

Deployment notes:

- The worker **dials out** to LiveKit Cloud: no inbound ports, no load balancer.
  A security group with egress only and a public subnet (no NAT gateway) is
  enough.
- `Dockerfile` runs `python agent.py start`. A build-time
  `python agent.py download-files` warms model files.
- **Guard the empty-credential case.** On first deploy the secret may be empty;
  a crash-looping task trips the ECS deployment circuit breaker and the service
  never stabilizes. Idle instead — and scope the guard to the `start` subcommand
  so it doesn't hang `download-files` during the image build:
    ```python
    if sys.argv[1:2] == ["start"] and not (os.getenv("LIVEKIT_URL") and os.getenv("LIVEKIT_API_KEY")):
        while True: time.sleep(60)
    ```
- Task role needs `bedrock:InvokeModelWithBidirectionalStream` (plus
  `InvokeModel`) on the Nova Sonic model.
- Env vars: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — inject from
  a secrets manager, never bake into the image.
- **ASCII only** in security-group descriptions: EC2 rejects non-ASCII (an
  em dash caused `GroupDescription is invalid`).

### 7.2 Token endpoint (Lambda)

```python
from livekit import api

def handler(event, _ctx):
    # API Gateway + Cognito authorizer has already verified the JWT.
    sub = event["requestContext"]["authorizer"]["claims"]["sub"]
    room = "app-" + re.sub(r"[^a-zA-Z0-9_-]", "-", sub)[:100]
    token = (
        api.AccessToken(API_KEY, API_SECRET)
        .with_identity(sub)                 # ties the participant to the user
        .with_name(sub)
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .to_jwt()
    )
    return {"statusCode": 200, "body": json.dumps(
        {"serverUrl": SERVER_URL, "token": token, "roomName": room})}
```

Return `serverUrl` in the response so the browser needs only one env var.

**Two mistakes worth avoiding:**

1. **Append the resource path.** If your env var is the API Gateway _stage root_
   (`https://xxx.execute-api.../prod/`), you must POST to
   `${base}livekit-token`. POSTing the bare root hits no method, API Gateway
   answers **403 without CORS headers**, and the browser reports a misleading
   opaque `NetworkError`/CORS failure.
2. **Add CORS to gateway error responses**, or every 401/403 looks like a CORS
   bug instead of an auth problem:
    ```ts
    api.addGatewayResponse("Default4xx", {
        type: apigateway.ResponseType.DEFAULT_4XX,
        responseHeaders: {
            "Access-Control-Allow-Origin": "'*'",
            "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
        },
    }); // repeat for DEFAULT_5XX
    ```

---

## 8. Credentials and configuration

Three values identify a LiveKit Cloud project:

| Value        | Example shape                        | Sensitivity                               |
| ------------ | ------------------------------------ | ----------------------------------------- |
| `url`        | `wss://<project>-<id>.livekit.cloud` | Low — reaches the browser anyway          |
| `api_key`    | `API…` (15 chars)                    | Low alone, **but** identifies the project |
| `api_secret` | 43-char base64                       | **HIGH — signs room tokens**              |

> **The `api_secret` is not stored in this repository, and should not be.**
> Anyone holding key + secret can mint tokens for your project. This repo is
> pushed to a shared remote, is configured for external export, and runs
> `gitleaks`; a secret committed here is effectively permanent in git history.
> Retrieve it from the sources below at setup time instead.

### Where the real values live

**On your machine** (written by `lk cloud auth`) — `~/.livekit/cli-config.yaml`:

```bash
# Print the active project's three values
python3 -c "
import yaml
cfg = yaml.safe_load(open('$HOME/.livekit/cli-config.yaml'))
p = [x for x in cfg['projects'] if x['name'] == cfg['default_project']][0]
print('url       =', p['url'])
print('api_key   =', p['api_key'])
print('api_secret=', p['api_secret'])
"
```

Also in the LiveKit Cloud console → _Settings → Keys_.

**In AWS** (this project) — Secrets Manager, `/<stack>/livekit`:

```bash
aws secretsmanager get-secret-value \
  --secret-id /<stack>/livekit --query SecretString --output text --profile <profile>
```

### Setting up a new project

```bash
brew install livekit-cli
lk cloud auth            # interactive browser login; writes ~/.livekit/cli-config.yaml

# Copy the values straight from the CLI config into a secret — never through a
# file in your repo, and never pasted into a terminal you don't control.
python3 -c "
import yaml, json
cfg = yaml.safe_load(open('$HOME/.livekit/cli-config.yaml'))
p = [x for x in cfg['projects'] if x['name'] == cfg['default_project']][0]
json.dump({'url': p['url'], 'api_key': p['api_key'], 'api_secret': p['api_secret']},
          open('/tmp/lk.json', 'w'))
"
aws secretsmanager put-secret-value \
  --secret-id /<new-stack>/livekit --secret-string file:///tmp/lk.json --profile <profile>
rm -f /tmp/lk.json

# Restart the worker so it picks the values up
aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment --profile <profile>
```

For local development, put the same three values in an untracked `.env.local`
(confirm it is gitignored).

### Confirming the worker connected

```bash
aws logs tail /aws/ecs/<stack>-livekit-worker --since 5m --format short
```

Success looks like:

```
registered worker  { "url": "wss://<project>.livekit.cloud", "region": "…" }
plugin registered  { "plugin": "livekit.plugins.aws" }
```

---

## 9. Gotchas, ranked by time lost

1. **`livekit-agents[mcp]`** — without the `[mcp]` extra, importing `mcp` raises
   `ModuleNotFoundError` and the container exits 1 in a loop.
2. **TalkingHead has no meshopt support** despite the README (§5).
3. **`gltf-transform optimize` silently breaks the rig** (§4).
4. **Token URL must include the resource path**, or you get a phantom CORS error
   (§7.2).
5. **`three` must be pinned/deduped to 0.180.x**, or npm nests a second copy.
6. **The idle guard must be scoped to `start`**, or it hangs the Docker build.
7. **Non-ASCII in an EC2 security-group description** is rejected outright.
8. **WebGL may be disabled** (VMs, remote desktop, `chrome://gpu`). Guard it, and
   record demos on a machine with hardware acceleration.
9. **API Gateway 4xx/5xx lack CORS headers** by default, masking real statuses.

---

## 10. Verification recipe

Prove the pipeline in isolation before wiring it into an app. A ~100-line Vite
page plus a Playwright driver is enough, and it catches every issue in §9 that
relates to the browser.

The page should: create the avatar, register the worklet, load the viseme model,
then synthesize a **`MediaStreamTrack`** (oscillator + band-pass + a syllabic
gain envelope → `createMediaStreamDestination()`) and wire it exactly as LiveKit
will — `track → createMediaStreamSource → HeadAudio`. Record results on
`window.__SPIKE` and set `window.__SPIKE_DONE`.

```js
// drive.mjs — headless verification
import { chromium } from "playwright";
const browser = await chromium.launch({
    channel: "chrome", // use installed Chrome; real GPU path
    args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-device-for-media-stream",
    ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => console.log(`[browser] ${m.text()}`));
await page.goto(process.env.SPIKE_URL, { waitUntil: "load", timeout: 120_000 });
await page.waitForFunction(() => window.__SPIKE_DONE === true, null, { timeout: 180_000 });
console.log(await page.evaluate(() => window.__SPIKE));
await page.screenshot({ path: "spike.png" }); // eyeball the avatar
await browser.close();
```

A passing run:

```json
{
    "webgl": true,
    "avatarLoaded": true,
    "morphTargetCount": 80,
    "workletRegistered": true,
    "modelLoaded": true,
    "visemeEvents": 30,
    "distinctVisemes": ["viseme_U", "viseme_RR", "viseme_I", "viseme_O", "viseme_E"],
    "errors": []
}
```

`visemeEvents > 0` with several **distinct** visemes is the real signal — it
proves classification is working, not just that audio arrived.

---

## 11. Known limitations

- **Lip-sync accuracy is good, not perfect.** HeadAudio's own docs note the
  audio-driven approach is less accurate than text-driven, especially at low
  SNR. End-to-end latency ≈ 50 ms; add a `DelayNode` (~100 ms) on the playback
  path if you want audio to trail the mouth rather than lead it.
- **WebGL required** for the avatar. Always ship a non-3D fallback.
- **First load ≈ 3.7 MB** for the GLB. Cache it at the CDN edge.
- **Tool-call scoping:** if you enforce per-user data scope with framework hooks
  (e.g. Strands `BeforeToolCallEvent`), those do **not** run on LiveKit's MCP
  path. Re-implement the injection as LiveKit `@function_tool` wrappers before
  relying on tenant isolation in the voice channel.
- **English viseme model.** `model-en-mixed.bin` is English-trained; other
  languages need a retrained model (HeadAudio ships training scripts).

---

## 12. References

| Project                 | License    | Link                                                                                                                             |
| ----------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| TalkingHead             | MIT        | https://github.com/met4citizen/TalkingHead                                                                                       |
| HeadAudio               | MIT        | https://github.com/met4citizen/HeadAudio                                                                                         |
| LiveKit Agents          | Apache-2.0 | https://docs.livekit.io/agents/                                                                                                  |
| Nova Sonic + LiveKit    | —          | https://aws.amazon.com/blogs/machine-learning/build-real-time-conversational-ai-experiences-using-amazon-nova-sonic-and-livekit/ |
| Nova Sonic 2 model card | —          | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-sonic.html                                         |
| MPFB (CC0 avatars)      | CC0 assets | https://static.makehumancommunity.org/mpfb.html                                                                                  |
| glTF-Transform          | MIT        | https://github.com/donmccurdy/glTF-Transform                                                                                     |

Reference implementation in this repo:

```
patterns/livekit-agent/                             # worker (Nova Sonic 2 + MCP)
lambdas/livekit-token/                              # token endpoint
lib/stacks/livekit/index.ts                         # VPC + Fargate + token API
lib/stacks/frontend/app/src/
  components/avatar/TalkingHeadAvatar.tsx           # avatar + HeadAudio
  lib/livekit-client/avatarLiveKitClient.ts         # room, mic, track plumbing
  types/met4citizen.d.ts                            # ambient types
```
