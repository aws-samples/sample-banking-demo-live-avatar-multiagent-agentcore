# Avatar Assets

## `trinity-advisor.glb`

The rigged CC0 avatar (MPFB, meshopt + webp compressed) used by the **Advisor**
variant (`realistic`), rendered via `@met4citizen/talkinghead` in
`../src/components/avatar/TalkingHeadAvatar.tsx`. Its 66 morph targets are
lip-synced from the live Nova Sonic audio by `@met4citizen/headaudio`
(see `../headaudio/`). Do not remove — the Advisor variant depends on it.

## Video avatar (`tavus`) — no asset here

The photoreal **"Realistic"** variant is rendered server-side by Tavus and
streamed to the browser as a WebRTC video track (see the
`tavus-avatar-integration` spec). It has no static asset in this directory; the
`<video>` element is fed by the Pipecat transport client, so nothing needs to be
committed here for it.
