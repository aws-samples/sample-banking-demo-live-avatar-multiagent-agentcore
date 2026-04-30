# Avatar GLB Assets

This directory is scanned at runtime by `Avatar3DHuman.ts` for `chef.glb`.

## How to populate it

1. Generate a Ready Player Me avatar at <https://readyplayer.me> and export
   as GLB (MIT-compatible for commercial use). Alternative: Microsoft
   RocketBox — <https://github.com/microsoft/RocketBox>, also MIT. Both provide
   ARKit 52-blend-shape rigs compatible with the `VISEME_TO_ARKIT` map in
   `Avatar3DHuman.ts`.
2. Drop the file here as `public/avatars/chef.glb`.
3. Extend `AvatarVariantName` in `../src/components/avatar/AvatarVariant.ts`
   to include `"human"`.
4. Add a `case "human":` branch in `createAvatar()` inside
   `Avatar3DReactWrapper.tsx`.
5. Add a button for the new variant in the picker row in `AvatarInterface.tsx`.

Until a `chef.glb` is present here, selecting the "human" variant (after the
wiring steps above) will render an empty scene and log a warning — that's by
design so the build doesn't require a large binary blob to be committed.
