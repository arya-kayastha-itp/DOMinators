# Delegation Map — Agents & Product Phase

Track 1 (Cloud) is **done**: both AWS accounts are live, peered, cross-account
IAM works, and the edge ALB serves the full legacy chain
(`/orders/` → pricing → catalog) plus `app-hello` on the golden module. See
[TRACK_1_CLOUD.md](TRACK_1_CLOUD.md), [ACCOUNT_A_SETUP.md](../infra/cloudformation/legacy/ACCOUNT_A_SETUP.md)
and [ACCOUNT_B_SETUP.md](../infra/terraform/ACCOUNT_B_SETUP.md).

Everything left is built by three parallel tracks. C1 and C2 move off cloud work
onto the new Track 4 (backend + frontend), which takes the orchestrator off A2 so
A2 can focus on the framework, Planning and integration.

| File | Track | People | Owns |
|---|---|---|---|
| [TRACK_1_CLOUD.md](TRACK_1_CLOUD.md) | Cloud — **complete** | (C1, C2) | Record of what's live + a short carry-over list (C1 does it within Track 4) |
| [TRACK_2_AGENTS_INTELLIGENCE.md](TRACK_2_AGENTS_INTELLIGENCE.md) | Agents — Discovery, Planning, framework core | A1, A2 | `agents/common/` (models, store, events, aws), Discovery, Planning, fleet generator, fixtures, integration captain |
| [TRACK_3_AGENTS_EXECUTION.md](TRACK_3_AGENTS_EXECUTION.md) | Agents — Blueprint, Cutover | A3, A4 | Blueprint/IaC (real `terraform apply`), Cutover (traffic gen, gates, auto-rollback) |
| [TRACK_4_BACKEND_FRONTEND.md](TRACK_4_BACKEND_FRONTEND.md) | Backend + Frontend | C1, C2 | Orchestrator API + SSE, LLM client/tool loop, cloud carry-over, reset scripts (C1); Dashboard (C2) |

Hand each track its one file. The interface tables inside each file are all
anyone needs for coordination.

**Code root:** the repo root. `infra/` holds both accounts
(`infra/cloudformation/legacy/` = A, `infra/terraform/` = B); `app/`, `data/`,
`agents/`, `fixtures/`, `orchestrator/`, `dashboard/` and `generated/` all sit at
the root, and `docs/` holds documents only. All paths in the track docs are
relative to the repo root.

---

## How parallelism works

Nobody waits on anybody after Gate 0. Every track builds against **frozen
contracts + fixtures + a fake of whatever it depends on**, then swaps the fake
for the real thing at Gate 2.

| Consumer | Depends on | Builds against until the real thing lands |
|---|---|---|
| Planning (A2) | Discovery output | `fixtures/apps.json`, `tiers.json`, `edges.json` + `data/fleet.json` |
| Blueprint (A3) | Real `AppRecord`s | `fixtures/apps.json` (3 real apps, hand-written from the live account) |
| Cutover (A4) | A real target app on the ALB | **Local fake ALB harness** — two local `server.py` processes + a weighted proxy (see Track 3) |
| Orchestrator (C1) | The four agents | Stub agents that return fixture objects and emit scripted events |
| Dashboard (C2) | Orchestrator API | Mock API serving `fixtures/` in the exact REST/SSE shapes |
| Everyone | LLM | `LLM_BACKEND=off` (rules) or `mock` (canned tool calls) |

## Gates (all tracks report against the same clock; H0 = kickoff of this phase)

| Gate | By | Pass condition |
|---|---|---|
| **G0 — contract freeze** | H+2 | `agents/common/models.py` + store/events signatures + agent entry points + `fixtures/` merged, exactly as in [CONTRACTS.md](CONTRACTS.md) (incl. the addendum). **The one deadline that must not slip.** |
| **G1 — everything runs on fakes** | H+8 | Each agent runs from the CLI on fixtures with `LLM_BACKEND=off`. Orchestrator serves fixtures + SSE. Dashboard shows Fleet + Activity from the mock API. `fleet.json` generated. Cloud carry-over IAM fixes applied. |
| **G2 — everything runs on real AWS** | H+16 | Discovery scans Account A for real. Blueprint applies `app-catalog` into Account B and it turns healthy. Cutover shifts real ALB weights on `app-catalog`. Orchestrator calls the real agents. Dashboard on the real API. |
| **G3 — first full dry run** | H+24 | All 3 real apps migrate end-to-end from the dashboard; bad wave on `app-orders` rolls back automatically; bugs sorted "must fix" / "narrate around". |
| **Feature freeze** | H+30 | Hardening, timing tuning, rehearsal only. |
| **Demo-ready** | H+36 | Demo runs 3× in a row without a code change; backup video recorded. |

## Dependency graph

```
Track 2 (A1, A2) ─┬─► everyone:  G0 contract freeze + fixtures (H+2)  ◄── single point of failure
                   ├─► Track 3:   real AppRecord[] for the 3 apps (H+12)
                   └─► Track 4:   agents callable via entry points (fixtures H+8, real H+16)

Track 3 (A3, A4) ─┬─► Track 4:   diff JSON + traffic/cutover shapes (frozen at G0); real data H+16
                   ├─► internal:  A3's BlueprintResult w/ real TG ARNs → A4 (app-catalog by H+14)
                   └─► Track 4:   Blueprint + Cutover callable from orchestrator (H+16)

Track 4 (C1, C2) ─┬─► Track 3:   IAM carry-over fixes (T1-1, T1-2) + target_outputs.json refresh (H+6)
                   ├─► all agents: llm.py / tools.py / loop.py (H+4), Bedrock model ID (asap)
                   └─► everyone:  orchestrator + dashboard = what judges see (G3)
```

**Track 2 owns the only hard cross-team deadline (G0).**
**Track 3 has the tightest internal seam** (A3 → A4 real ARNs), mitigated by A4's local fake ALB.
**Track 4 is the least blocked** — it builds entirely on fixtures until G2.

---

## Standup format (every 4 hours, 10 min max)

Each track in order — 2, 3, 4: *What's done. What's next. What's blocked.*
Blockers older than 30 minutes escalate to **A2** (agents/integration) or **C1**
(infra/backend). A2 and C1 never sleep at the same time.

## Branches and PRs (see [AGENTS.md](../AGENTS.md))

- One personal branch per person; PRs target your own branch, never `main`.
- Every push/PR updates [checklist.md](../checklist.md) in the same commit.
- Stay inside your own directories to avoid merge conflicts:
  `agents/discovery/` (A1), `agents/planning/` + `data/` + `fixtures/` + `agents/common/{models,store,events}.py` (A2),
  `agents/blueprint/` + `templates/` (A3), `agents/cutover/` (A4),
  `orchestrator/` + `agents/common/{llm,tools,loop}.py` + `scripts/` (C1), `dashboard/` (C2).
  `agents/common/aws.py` is A1's. Cross-directory changes need the owner's review.

## Never cut, regardless of track

1. The live config diff (Track 3)
2. The live traffic shift (Track 3)
3. The auto-rollback (Track 3)

## Cut list, in order, if behind

1. VPC Flow Log dependency inference (Track 2) — tags + SSM + SG references only
2. LLM-written rationale text in Planning (Track 2) — template string
3. Dependency-graph full-fleet view (Track 4) — real apps + 2-hop only
4. Live `terraform apply` of `app-catalog` on stage (Track 3) — show the pre-applied result
5. The 10% traffic step (Track 3) — go straight 0 → 50 → 100
