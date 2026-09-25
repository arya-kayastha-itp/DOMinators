# Dashboard

**Owners:** C2 (UI, from hour 16) and A2 (API/SSE). Each agent owner reviews their own panel.

**Stack:** React + Vite, React Flow (dependency graph), Recharts (charts), Tailwind (optional).

**Data sources:** the orchestrator REST API plus the `GET /events` SSE stream. The UI is never the source of truth: after a refresh it rebuilds everything from the API.

## Views

| Tab | Shows | Fed by | Owner check |
|---|---|---|---|
| **Fleet** | Tier counts, finding heatmap, and a table of 1,000 apps with a filter; real apps get a badge | `/apps` | A1 |
| **Dependencies** | Graph coloured by tier. Default: real apps plus their 2-hop neighbours; toggle to show the full fleet (clustered) | `/apps`, edges | A1 |
| **Plan** | Wave timeline stacked by tier, a capacity slider, and the projection card ("Finish: Sep 2027 ✓ target 2027") | `/plan` | A2 |
| **Blueprint** | Side-by-side diff (legacy on the left, generated HCL on the right) with fix annotations, and plan/apply status | `/blueprints/{id}` | A3 |
| **Cutover** | Per-app live chart of legacy vs. target share, weight-step markers, gate status lights, and the rollback banner | `/cutovers/{id}`, traffic, events | A4 |
| **Activity** | Live event log, including the simulated steps (data migration progress, decommission, license flags, notifications) | `/events` | A2 |

## Demo controls (hidden behind `?demo=1`)

- Run discovery
- Build plan
- Generate/apply per app
- Cut over per app
- Run wave N
- Bad-wave toggle
- Reset

## Build order

1. Hour 16–20: Fleet table from the fixtures.
2. Hour 20–24: SSE hookup and the Activity log.
3. Hour 24–28: Plan view and the Blueprint diff (use `react-diff-viewer` or a simple two-pane view).
4. Hour 28–32: Cutover live chart and the rollback banner.
5. Hour 32+: Dependency graph polish, then the impact panel.

## Rules

- Big, readable numbers. Judges see this from about 3 metres away.
- One colour meaning, everywhere:
  - Golden = green
  - Gray = amber
  - Red = red
  - Legacy = gray
  - Target = blue
- Every button shows a loading state, and every error shows a clear message. Nothing should fail silently on stage.
- Test on the actual projector resolution before hour 40.
