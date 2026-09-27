# Migration Accelerator Console

The judge-facing console for the Cloud Migration Accelerator (Track 4, frontend), wired to the
real orchestrator (`orchestrator/`, FastAPI). Seven routed screens — Overview, Fleet,
Dependencies, Wave plan, Blueprint, Cutover, Activity — plus the `/journey` landing page, a
command palette, a Copilot panel and stage demo controls. **Every number on screen comes from
the orchestrator**; nothing is simulated in the browser.

## Run it

From the repo root, one command starts both (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

or by hand:

```bash
uvicorn orchestrator.main:app --port 8000   # repo root; needs .env + data/target_outputs.json
cd migration-accelerator-console
corepack pnpm install                        # pnpm is pinned in package.json (packageManager)
corepack pnpm dev                            # http://localhost:3000
```

The console talks to `NEXT_PUBLIC_API_BASE` (default `http://localhost:8000`). Append `?demo=1`
for the operator dock. `terraform` must be on the orchestrator's PATH for blueprint apply.

### Deployed

The console and orchestrator also run in Account B behind CloudFront
(`infra/terraform/modules/control_plane`). From the repo root:

```bash
python scripts/deploy_control_plane.py      # build (static export, API at /api), bundle, upload, restart
```

Visitors get a read-only console; the operator unlocks actions with the key in
SSM `/mig/control-plane/operator_key` (top bar → View only → Unlock).

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ K` | Command palette — pages, agent actions, app search, theme |
| `Ctrl/⌘ J` | Copilot panel |
| `[` | Collapse / expand the sidebar |

## What happens when you click

| Button | Orchestrator call | What really runs |
|---|---|---|
| Run discovery | `POST /runs/discovery` | Read-only scan of Account A's legacy VPC + the synthetic fleet, tiering (LLM breaks borderline ties) |
| Build / commit plan | `POST /runs/planning` | The real planner; the capacity slider previews via `GET /plan/preview` (not saved) |
| Generate & apply | `POST /runs/blueprint/{app}?apply=true` | golden_app Terraform rendered and **applied into Account B**; terraform output streams into the Blueprint terminal |
| Cut over | `POST /runs/cutover/{app}` | A traffic generator sends ~20 req/s through the **real ALB** while weights move 10 → 50 → 100% with gates; automatic rollback to 100/0 on a failed gate |
| Run wave N | `POST /runs/wave/{n}` | Real apps: apply + cutover. Synthetic apps: blueprint dry run + simulated cutover (events say `sim`) |
| Bad wave | `POST /demo/bad-wave` | app-orders' next blueprint drops `UPSTREAM_URL` → the gate must catch it |
| Reset (+ destroy) | `POST /demo/reset[?destroy=true]` | Weights 100/0 everywhere, optionally `terraform destroy` every generated app, store cleared |

The orchestrator refuses out-of-order runs with HTTP 409 and a reason (e.g. cutover before the
app is PROVISIONED, anything on a parked RED app), and a second run on a busy app.

## How it's put together

```
app/(console)/*/page.tsx        one route per screen
components/views/*              the screens (client components)
components/shell/*              sidebar, top bar, command palette, Copilot, demo dock
components/console/console-provider.tsx
                                live state: REST snapshots + the SSE stream (GET /events),
                                targeted refetch per event type, the real run actions
components/console/traffic-flow.tsx
                                canvas: one particle per real request, to the side that answered
lib/api.ts                      typed orchestrator client + response shapes
lib/live.ts                     cutover steps/gates and blueprint stages derived from events
lib/meta.ts                     labels for backend codes (no numbers)
lib/contracts.ts                TypeScript mirror of docs/CONTRACTS.md
```

## Design system

- Tokens in `app/globals.css` (oklch), light + dark, switched by `next-themes`.
- Brand violet + cyan accent; semantic colours are fixed project-wide:
  Golden = green, Gray = amber, Red = red, Legacy = slate, Target = blue.
- Geist Sans / Geist Mono, 4 px spacing scale on an 8 px rhythm, three elevation levels.
- Motion via Framer Motion, disabled automatically for `prefers-reduced-motion`.
- Accessibility: skip link, visible focus rings, ARIA on every control, keyboard-operable tables
  and dialogs, and a text edge list alongside the WebGL graph.
