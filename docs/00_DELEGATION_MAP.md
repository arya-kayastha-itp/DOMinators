# Delegation Map — 3 Tracks

| File | Track | People |
|---|---|---|
| `TRACK_1_CLOUD.md` | Cloud | C1, C2 |
| `TRACK_2_AGENTS_INTELLIGENCE.md` | Agents — Discovery, Planning, Orchestration | A1, A2 |
| `TRACK_3_AGENTS_EXECUTION.md` | Agents — Blueprint, Cutover | A3, A4 |

Hand each track its one file. Nobody needs to read another track's doc to start working — only the interface tables inside their own file matter for coordination.

---

## Why the seam sits where it does

The agent pipeline is `Discovery → Planning → Blueprint → Cutover`. The cut between Track 2 and Track 3 falls exactly on the pipeline's midpoint — which is also exactly where the contract handoff already lives (`WavePlan` → `BlueprintResult`). Nothing was forced to make this split; it was already there.

**The split is not even by job count, and that's deliberate:**

| | Track 2 | Track 3 |
|---|---|---|
| Sub-jobs | 4 (Discovery, Planning, synthetic data, orchestrator/integration) | 2 (Blueprint, Cutover) |
| Character | Breadth — many lighter, mostly-rule-based pieces | Depth — fewer pieces, each a judge-facing "wow moment" |
| Why it balances | Planning was deliberately built lightweight specifically to free up slack for the framework + integration work | Blueprint and Cutover each carry a live, high-stakes demo moment (the diff, the rollback) that needs dedicated tuning time |

If you rebalanced by raw task count instead, you'd break the natural handoff and end up with two people owning half of Blueprint or half of Cutover — worse for parallelism, not better.

---

## The 3-node dependency graph (replaces the old 6-node one)

```
Track 1 (Cloud) ──────┬──► Track 2 needs: mig-discovery-readonly role (h8), 3 real legacy apps (h8)
                       └──► Track 3 needs: golden_app schema (h10), edge ALB ARNs (h12),
                                            bad-wave app behavior (h16), tf state backend (h20)

Track 2 (Intelligence) ─┬─► Track 1 needs: nothing blocking — dashboard just consumes frozen contracts
                         ├─► Track 3 needs: agents/common + fixtures (h2, HARD DEADLINE),
                         │                   real AppRecord[] (h20)
                         └─► Everyone needs: contract freeze (h2) — the single point of failure
                                              in the whole plan

Track 3 (Execution) ────┬─► Track 1 needs: diff JSON + cutover event shape, for the dashboard (h2/h24)
                         └─► Track 2 needs: both agents callable from orchestrator (h20)
```

**Track 1 is the least blocked** — almost everything in hours 0–12 is pure Terraform, independent of agent progress.
**Track 2's hour-2 contract freeze is the one deadline that must not slip** — Track 1's dashboard and Track 3's whole build depend on having a stable shape to build against before real data exists.
**Track 3 has the tightest internal coupling** — A3→A4 (`BlueprintResult` with real ARNs) has to land by hour 20–26 or Cutover has nothing real to shift traffic on.

---

## Standup format (every 4 hours, 10 min max)

Each track, in order — Track 1, Track 2, Track 3:
> What's done. What's next. What's blocked.

Blockers older than 30 minutes escalate to **Track 2** (agent/integration questions) or **Track 1** (infra questions).

## Shared checkpoints (all 3 tracks report against the same clock)

| Checkpoint | Hour | Pass condition |
|---|---|---|
| 1 | 8 | Track 1: 3 legacy apps up, readonly role tested. Track 2: contracts frozen, fixtures committed, `fleet.json` generated |
| 2 | 20 | Both agent tracks run standalone from the CLI against real accounts. Track 1: dashboard shows fleet view from fixtures |
| 3 | 32 | All 3 real apps migrate end-to-end from the dashboard; bad wave rolls back automatically; remaining bugs sorted "must fix" vs. "narrate around" |
| Feature freeze | 40 | No new features — hardening and rehearsal only |

## Never cut, regardless of track

1. The live config diff (Track 3)
2. The live traffic shift (Track 3)
3. The auto-rollback (Track 3, with Track 1's bad-wave setup)

## Cut list, in order, if behind

1. VPC Flow Log dependency inference (Track 2) — tags + SG references only
2. LLM-written rationale text in Planning (Track 2) — template string
3. Live `terraform apply` of app-catalog on stage (Track 3) — show the pre-applied result
4. The 10% traffic step (Track 3) — go straight 0 → 50 → 100

## Sleep rotation

Stagger two 4-hour blocks so no more than 2 people are offline at once. Track 1's C1 and Track 2's A2 never sleep at the same time — they're the two escalation points.
