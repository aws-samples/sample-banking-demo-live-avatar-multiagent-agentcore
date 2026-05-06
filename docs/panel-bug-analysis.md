# Resizable Side-Panel Bug — Audit & Fix Plan

## Summary

Dragging the divider on `/menu` and `/chat` does nothing — the sidebar appears as
a ~320 px sliver on the left and never resizes. Root cause: the **direct
children of each `Panel`** fix their own width with Tailwind classes
(`w-80 lg:w-96 flex-none`), which overrides the Panel's percent-based flex-basis
sizing. The Panel happily resizes its wrapper `div`, but the fixed-width child
inside never changes size, so the user sees no effect.

A second, cumulative cause: `react-resizable-panels@4` rehydrates layouts from
`localStorage` on every mount. Any session that previously persisted a
collapsed/broken layout (e.g. `{menu-main: 95, menu-sidebar: 5}`) stays broken
forever on that browser until the key is cleared.

## Consumers of `ResizablePanelLayout`

Found via `rg -l ResizablePanelLayout src/`:

| File | `autoSaveId` | Status |
|---|---|---|
| `components/chat/ChatInterface.tsx` | `"chat"` | **Broken** — main column uses `flex-1` fighting Panel sizing; sidebars are OK (use `w-full`). Bump to `"chat-v2"`. |
| `routes/MenuPage.tsx` | `"menu"` | **Broken** — `MenuPipelineSidebar` child uses `w-80 lg:w-96 flex-none` (expanded) and `flex-none` (collapsed). Bump to `"menu-v2"`. |
| `components/avatar/AvatarInterface.tsx` | `"avatar-v2"` | **OK** — already uses CSS-class children with no hard-coded widths; already versioned. No change needed. |

No other files import the layout. `/research`, `/research-studio`, `/archive`
all render via `ChatInterface`, so the chat fix covers them.

## Direct-child offenders (fixed-width inside a `Panel`)

| File | Line | Offending class | Fix |
|---|---|---|---|
| `routes/MenuPage.tsx` | 61 | `flex-none flex flex-col items-center py-3 glass-panel-strong` (collapsed sidebar) | Drop `flex-none`; use `h-full w-full min-w-0 flex flex-col items-center py-3 glass-panel-strong`. |
| `routes/MenuPage.tsx` | 76 | `w-80 lg:w-96 flex-none overflow-y-auto flex flex-col glass-panel-strong` (expanded sidebar) | Drop `w-80 lg:w-96 flex-none`; use `h-full w-full min-w-0 overflow-y-auto flex flex-col glass-panel-strong`. |
| `components/chat/ChatInterface.tsx` | 184 | `flex flex-col h-full min-w-0 flex-1` (main chat column inside a Panel) | Drop `flex-1` — the Panel already sizes; keep `min-w-0 h-full w-full flex flex-col`. |
| `components/menu/MenuSidePanel.tsx` | 23 | `w-80 lg:w-96 flex-none overflow-y-auto flex flex-col glass-panel-strong` | Same swap. **Note:** `MenuSidePanel` is not currently imported anywhere (dead code) — fixing it preserves consistency for when it is re-wired. |

## Safe existing patterns (don't change)

- `ConciergeFlowSidebar.tsx` — `flex h-full w-full shrink-0 flex-col`. `w-full`
  fills the Panel; `shrink-0` is inert because the Panel wrapper controls the
  flex-basis. OK as-is.
- `BrowserLiveViewSidebar.tsx` — same pattern. OK.
- `AvatarInterface.tsx` — uses CSS-class children (`avatar-page__avatar-col`,
  etc.) that flex naturally. OK.

## Drag-handle affordance issues

- Handle is only 4 px wide — hard to grab on a high-DPI display.
- Grip dots have `opacity: 0` at idle — no visual hint the handle is
  interactive.
- Only a single AWS-orange hover colour indicates drag capability.

Fix: widen the **hit target** to ~16 px via `::before` (keep the visible strip
at ~6 px), raise idle grip-dot opacity to ~0.35, keep AWS orange
(`#FF9900`) on hover/focus. `react-resizable-panels` already emits
`role="separator"` with ArrowLeft/ArrowRight keyboard support — do not clobber.

## localStorage cleanup

Bump `autoSaveId`s:
- `"chat"` → `"chat-v2"`
- `"menu"` → `"menu-v2"`
- `"avatar-v2"` stays (already versioned).

Add a one-time migration in `main.tsx` that removes legacy keys
(`resizable-layout-chat`, `resizable-layout-menu`). Idempotent; safe on repeat.

## Follow-ups (not in this PR)

- Consider extracting the sidebars' width/collapse state into Zustand so
  toggles persist across navigations (currently re-mounts reset state).
- `MenuSidePanel.tsx` is dead code; decide whether to delete or wire it up.
- Avatar's `KbPipelineChips` strip sits above the resizable area — no panel
  treatment needed today.
