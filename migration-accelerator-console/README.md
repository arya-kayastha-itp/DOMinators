# Migration Accelerator Console

The judge-facing console for the Cloud Migration Accelerator (Track 4, frontend). Eight routed
screens over one shared state: Overview, Fleet, Dependencies, Wave plan, Blueprint, Cutover,
Activity, Impact — plus a command palette, an AI Copilot panel, and stage demo controls.

## Run it

```bash
corepack pnpm install        # pnpm is pinned in package.json (packageManager)
corepack pnpm dev            # http://localhost:3000
```

Append `?demo=1` to any URL for the operator dock (discovery → plan → blueprint → cut over →
bad wave → reset, in DEMO_SCRIPT order).

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ K` | Command palette — pages, agent actions, app search, theme |
| `Ctrl/⌘ J` | Copilot panel |
| `[` | Collapse / expand the sidebar |

## How it's put together

```
app/(console)/*/page.tsx        one route per screen (server components: metadata + Suspense)
components/views/*              the screens (client components)
components/shell/*              sidebar, top bar, command palette, Copilot, demo dock
components/console/console-provider.tsx
                                global state + deterministic simulations of the 4 agents
components/console/bits.tsx     tier/status badges, KPI cards, page header, nav model
components/ui/primitives.tsx    Card, Badge, Tooltip, Segmented, Progress, Skeleton, CountUp…
lib/contracts.ts                TypeScript mirror of docs/CONTRACTS.md
lib/data/*                      mock fleet (3 real apps + 1,000 seeded), tiering rules,
                                planner, blueprint generator, seed events
lib/copilot.ts                  rules-grounded Q&A over live state (cites its evidence)
```

**Mock today, live later.** Every screen reads contract-shaped data. To connect the orchestrator,
replace the bodies of the `run*` actions in `console-provider.tsx` with `POST /runs/*` and feed
`events` from `GET /events` (SSE, `Last-Event-ID`) — the screens don't change.

**Simulation fidelity.** The Cutover screen runs the real procedure from docs/TRACK_3: precheck →
10 → 50 → 100% with a 5 s observe window (compressed from 20 s), ~20 req/s, deterministic gates
(error rate ≤ 2%, p95 ≤ 800 ms, statistically-tested target share), rollback to 100/0, then an
explanation written after the decision. The bad-wave variant breaks the target because the applied
inputs have `REQUIRE_UPSTREAM=1` without `UPSTREAM_URL` — the same mechanism as `app/server.py`.

## Design system

- Tokens in `app/globals.css` (oklch), light + dark, switched by `next-themes`.
- Brand violet + cyan accent; semantic colours are fixed project-wide:
  Golden = green, Gray = amber, Red = red, Legacy = slate, Target = blue.
- Geist Sans / Geist Mono, 4 px spacing scale on an 8 px rhythm, three elevation levels.
- Motion via Framer Motion, disabled automatically for `prefers-reduced-motion`.
- Accessibility: skip link, visible focus rings, ARIA on every control, keyboard-operable tables
  and dialogs, and a text edge list alongside the WebGL graph.
