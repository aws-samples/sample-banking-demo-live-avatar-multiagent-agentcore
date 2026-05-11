# Resizable Side-Panel Bug — Audit & Status

## Summary

Dragging the divider on `/menu` and `/chat` used to do nothing — the sidebar
appeared as a ~320 px sliver on the left and never resized. Root cause: the
**direct children of each `Panel`** fixed their own width with Tailwind
classes (`w-80 lg:w-96 flex-none`), which overrode the Panel's percent-based
flex-basis sizing.

A second, cumulative cause: `react-resizable-panels@4` rehydrates layouts
from `localStorage` on every mount. Any session that previously persisted
a collapsed/broken layout stayed broken forever on that browser until the
key was cleared.

**Status: FIXED.** All three fixes below are in the current codebase. The
file is kept as a reference for anyone adding new consumers of
`ResizablePanelLayout`.

## Consumers of `ResizablePanelLayout`

| File                                    | `autoSaveId`  | Status                                                                   |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `components/chat/ChatInterface.tsx`     | `"chat-v3"`   | ✅ Fixed — main column uses `h-full w-full min-w-0`, no hardcoded widths |
| `routes/MenuPage.tsx`                   | `"menu-v3"`   | ✅ Fixed — collapsed + expanded sidebar both use `h-full w-full min-w-0` |
| `components/avatar/AvatarInterface.tsx` | `"avatar-v2"` | ✅ OK — was always using CSS-class children with no hard-coded widths    |

Searches confirm the absence of offenders:

```bash
rg -n 'w-80 lg:w-96|flex-none' lib/stacks/frontend/app/src/routes/MenuPage.tsx
rg -n 'w-80|w-96|flex-none' lib/stacks/frontend/app/src/components/menu/MenuSidePanel.tsx
```

Both return zero matches.

## Fixes applied

1. **Direct-child width classes removed.** Every `Panel` direct child now
   uses `h-full w-full min-w-0` (plus `flex flex-col` where needed). The
   Panel's flex-basis percentage is what sizes the wrapper.

2. **`autoSaveId` bumps.** `"chat"` → `"chat-v3"`, `"menu"` → `"menu-v3"`
   force fresh layouts for users who had broken saved state.

3. **`localStorage` migration in `main.tsx`.** `migrateResizablePanelLayouts()`
   removes legacy keys (`resizable-layout-chat`, `resizable-layout-menu`,
   `resizable-layout-chat-v2`, `resizable-layout-menu-v2`) on every app
   boot. Idempotent; safe on repeat.

## If you add a new consumer

- Put `h-full w-full min-w-0` on every direct child of a `Panel`. `min-w-0`
  in particular is required so the Panel can actually shrink below the
  child's natural content width.
- Never use `flex-none` or `w-{px}` on a direct child of a `Panel` — it
  overrides `react-resizable-panels`' width control.
- If you change panel semantics in a way that could break saved layouts,
  bump the `autoSaveId` and add the old key to `migrateResizablePanelLayouts`
  in `main.tsx`.

## Related fixes

The panel fixes landed alongside `Task 8` from the `audit-and-fixes` plan,
which also added:

- `place_order` to `USER_SCOPED_TOOLS` so the concierge's ordering path
  has a verified `customerId` on every DynamoDB item.
- `asyncio.get_running_loop()` replacements for the three deprecated
  `asyncio.get_event_loop()` call sites in `orchestrator_agent.py`.
- A 30-second timeout on the chatbot's `_tool_use_active` flag so a
  missing `message` event doesn't permanently swallow streamed text.

See `docs/kb-isolation.md` for the broader isolation model these fixes
are part of.
