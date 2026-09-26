# Track 4 — Backend & Frontend

**Members:** C1 (backend), C2 (frontend) — both freed up now that Track 1 (Cloud) is done.
**Owns:** the orchestrator API + SSE, the shared LLM client / tool registry / agent loop,
the orchestrator's safety watchdog, demo/reset scripts, the cloud carry-over list, and
the dashboard.

**Why this track exists:** in the original plan A2 owned the orchestrator *and* the
framework *and* Planning *and* integration, and C2 joined the dashboard only at hour
16. With the cloud finished, moving the orchestrator and the LLM plumbing to C1 and
starting the dashboard at H0 takes the bottleneck off A2 and lets the product surface
be built in parallel with the agents, not after them.

All paths are relative to the repo root.
Clock: H0 = kickoff of this phase. Gates: G0 H+2, G1 H+8, G2 H+16, G3 H+24.

---

## Internal split and schedule

| | C1 — Backend | C2 — Frontend |
|---|---|---|
| **H0–2** | Start **T1-1 / T1-2** (they unblock Track 3). FastAPI skeleton with every route stubbed. Review `models.py` at the G0 walkthrough | Vite + React + TS scaffold, 6-tab layout, colour tokens, TypeScript types mirroring CONTRACTS (incl. addendum) |
| **H2–8** | `llm.py` / `tools.py` / `loop.py` by **H+4**. Orchestrator on **stub agents** + SSE by H+8. T1-3, T1-4, T1-5 | Mock API serving `fixtures/` in the exact REST/SSE shapes. **Fleet** table + **Activity** log running on the mock (G1) |
| **H8–16** | Swap stubs for real agent entry points as they land; run locks, lifecycle enforcement, background runs; traffic-generator autostart; **watchdog**; T1-6, T1-7 | **Plan** (capacity slider + projection), **Blueprint** diff, **Cutover** live chart — all on fixtures |
| **H16–24** | Real agents end-to-end with A2; demo endpoints; `make demo-reset` / `demo-check` (T1-8) | Switch to the live API; **Dependencies** graph; rollback banner; demo controls |
| **H24–30** | "Must fix" bugs from G3; T1-9 timed rebuild test | Impact panel; loading/error states everywhere; projector-resolution test |
| **H30–36** | Presenter; backup video from the first clean rehearsal | Demo operator; polish only |

---

## C1's job: Backend

### Cloud carry-over — do first

T1-1 … T1-10 are listed with reasons in [TRACK_1_CLOUD.md](TRACK_1_CLOUD.md).
**T1-1 and T1-2 block Track 3's real runs — finish them by H+6.** T1-5 (developer
access) blocks every agent's real-AWS phase — finish by H+8.

### Shared LLM plumbing (`agents/common/`) — by H+4

| ID | Task |
|---|---|
| T4-L-1 | `llm.py` — backends selected by `LLM_BACKEND`: `bedrock` (`AnthropicBedrock`, `AWS_REGION=ap-south-1`, model from `LLM_MODEL_ID` — never hardcoded), `anthropic` (API-key fallback), `off` (raises `LLMOff`, so callers use their rules path), `mock` (canned tool calls from `fixtures/llm_mock/*.json`). 20 s timeout on every call. Helper `call_tool(system, user, tool) -> dict` for forced structured output |
| T4-L-2 | `tools.py` — `@tool` decorator that builds the JSON schema from a Pydantic args model; registry; argument validation; `mutating=True` tools must pass `aws.assert_managed(arn)` |
| T4-L-3 | `loop.py` — `run_agent(system, user, tools, max_turns=8)`; emits `TOOL_CALL` for each call and `LLM_FALLBACK` on timeout/validation failure; never lets an exception escape without an event |
| T4-L-4 | Tests with `LLM_BACKEND=mock`; one live smoke test against Bedrock once T1-3 is done |

### Orchestrator (`orchestrator/`) — stub mode by H+8, real by H+16

| ID | Task |
|---|---|
| T4-O-1 | FastAPI app (`uvicorn orchestrator.main:app --port 8000`), CORS for the Vite dev server, `/healthz` |
| T4-O-2 | Every endpoint in [CONTRACTS.md](CONTRACTS.md) + addendum. `POST /runs/*` return `202 {run_id}` and run in a background worker (agents are sync boto3 → thread pool); a per-app lock returns `409` on a second concurrent run |
| T4-O-3 | **Stub mode** (`AGENTS_MODE=stub`): agents replaced by stubs that return fixture objects and replay `fixtures/events.jsonl` on a timer. This is what C2 builds the whole UI against before any agent exists |
| T4-O-4 | `GET /events` SSE: tails the events table (~100 ms), honours `Last-Event-ID` so a refreshed dashboard replays what it missed, keep-alive ping every 15 s |
| T4-O-5 | Lifecycle enforcement ([FLOW.md](FLOW.md) §2): the orchestrator owns state transitions and rejects out-of-order runs (e.g. cutover before `PROVISIONED`) with a clear error |
| T4-O-6 | `POST /runs/wave/{n}`: real apps → blueprint (apply) then cutover, in wave order; synthetic apps → blueprint dry-run + A4's simulated cutover |
| T4-O-7 | `/demo/bad-wave {app_id, enabled}` sets the store flag Blueprint reads; `/demo/reset` sets weights to 100/0 on all 3 rules (via A4's `weights.py`) and calls `store.reset()`; `?destroy=true` also destroys `generated/*` |
| T4-O-8 | Start A4's traffic generator as a background task at boot (`TRAFFIC_AUTOSTART=1`) |
| T4-O-9 | **Watchdog**: every 1 s, any app in `CUTTING_OVER` whose `cutover_heartbeat:<app>` is older than 5 s gets weights reset to 100/0 and a `ROLLED_BACK{reason: "watchdog"}` event. This is the only protection against a hard-killed cutover process |
| T4-O-10 | API tests with FastAPI's `TestClient` against stub mode |

### Scripts

| ID | Task |
|---|---|
| T4-S-1 | `Makefile`: `make run` (orchestrator + traffic + dashboard), `make demo-reset`, `make demo-check`, `make e2e` (A2's `scripts/e2e_real.sh`), `make destroy` (target before legacy) |

---

## C2's job: Frontend (Dashboard)

**Stack (as built):** the console lives in [`migration-accelerator-console/`](../migration-accelerator-console/) —
Next.js 16 (App Router, one route per tab) + TypeScript + Tailwind v4 + Base UI / shadcn + Framer Motion,
Recharts (charts), three.js (3D dependency graph), `cmdk` (command palette), `sonner` (toasts),
`next-themes` (light/dark). It replaces the Vite + React Flow plan above; `dashboard/README.md`
still describes the views. Data comes from a contract-shaped mock layer (`lib/contracts.ts`,
`lib/data/*`) and a state provider that simulates the four agents — swapping in the orchestrator
means replacing the `run*` actions in `components/console/console-provider.tsx` with `POST /runs/*`
+ the `/events` SSE stream, not changing screens. The UI is never the source of truth: after a
refresh it must rebuild everything from the REST API, then resume SSE from `Last-Event-ID`.

### Tasks

| ID | Task |
|---|---|
| T4-F-1 | Scaffold: layout, 6 tabs + impact panel, colour tokens — **Golden=green, Gray=amber, Red=red, Legacy=gray, Target=blue**, used identically everywhere |
| T4-F-2 | Typed API client + `useEvents()` SSE hook with reconnect and `Last-Event-ID`; `VITE_API_MODE=mock|live` |
| T4-F-3 | Mock API (MSW or a Vite middleware) serving `fixtures/` in the exact REST/SSE shapes, replaying `events.jsonl` |
| T4-F-4 | **Fleet** — tier counts, finding heatmap, virtualized table of ~1,000 apps with filters; "real" badge on the 3 live apps (`/apps`, `/tiers`) |
| T4-F-5 | **Activity** — live event log incl. simulated steps (data migration, decommission, license flags, notifications as toasts) (`/events`) |
| T4-F-6 | **Plan** — wave timeline stacked by tier; capacity slider → `POST /runs/planning?capacity=N`; projection card ("Finish: Sep 2027 ✓ target 2027") (`/plan`) |
| T4-F-7 | **Blueprint** — side-by-side diff (legacy left, generated HCL right) with finding → fix annotations, validate/plan/apply status, Generate/Apply buttons (`/blueprints/{id}`) |
| T4-F-8 | **Cutover** — per-app live chart of legacy vs. target share (1 s buckets from `/traffic/{app_id}`), `WEIGHT_SET` markers, gate status lights, red rollback banner with the reason + explanation (`/cutovers/{id}`, events) |
| T4-F-9 | **Dependencies** — React Flow graph coloured by tier; default = real apps + 2-hop neighbours; full-fleet clustered view is on the cut list (`/edges`) |
| T4-F-10 | **Impact** panel — Golden flows untouched / Gray gets one approval / Red to engineers; apps/day; finish date vs. 2027 |
| T4-F-11 | Demo controls behind `?demo=1`: Run discovery, Build plan, Generate/Apply per app, Cut over per app, Run wave N, Bad-wave toggle, Reset (`/demo/state` shows current flags) |
| T4-F-12 | Every button has a loading state, every error a visible message — nothing fails silently; big numbers readable from ~3 m; test at the projector's resolution before feature freeze |

---

## Interface to the other tracks

### What Track 4 needs

| From | What | By | If late |
|---|---|---|---|
| Track 2 (A2) | G0 models, store/events signatures, agent stubs, `fixtures/` incl. `events.jsonl` | H+2 | Hard blocker for stub mode and the mock API — help A2 finish it |
| Track 2 / 3 | Agent entry points working on fixtures | H+8 | Stay in stub mode |
| Track 2 / 3 | Agent entry points working on real AWS | H+16 | Stub mode for the missing agent; the rest runs real |
| Track 3 (A4) | `weights.py` (for reset + watchdog) and the traffic generator | H+12 | Reset via AWS CLI in `make demo-reset` |

### What Track 4 delivers

| To | What | By |
|---|---|---|
| Track 3 | T1-1, T1-2, T1-4 (IAM fixes, `app_routes` output) | **H+6** |
| Everyone | T1-5 developer access to Account B; `.env.example` complete | H+8 |
| Tracks 2 & 3 | `llm.py` / `tools.py` / `loop.py` with `off` + `mock` | H+4 |
| Everyone | Bedrock model ID (T1-3) | asap, not blocking |
| Everyone | Orchestrator in stub mode + dashboard on the mock API | H+8 (G1) |
| Everyone | Orchestrator on real agents + dashboard on the live API | H+16 (G2) |

## Definition of Done

- [ ] T1-1 … T1-9 done (T1-10 decided)
- [ ] `llm.py` / `tools.py` / `loop.py` merged; every agent works with `off`, `mock` and `bedrock`
- [ ] Orchestrator serves every CONTRACTS endpoint; runs are async with per-app locks; SSE replays after refresh
- [ ] Watchdog resets weights after a hard-killed cutover (tested)
- [ ] `make demo-reset` and `make demo-check` work and are used before every rehearsal
- [ ] Dashboard renders all 6 tabs + impact panel from the live API, survives a refresh, tested at projector resolution
- [ ] Full teardown/rebuild timed under 20 minutes; backup video recorded
