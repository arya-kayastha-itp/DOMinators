# Track 2 — Agents: Intelligence & Orchestration

**Members:** A1, A2 (2 people). **Owns:** Discovery agent, Planning agent, synthetic fleet generator, the shared agent framework everyone builds on, the orchestrator API, and integration-captain duty for the whole project.

This track answers "what exists, and what order do we do it in" — and, because that work is deliberately lighter per-agent than Track 3's, also carries the plumbing that holds the whole system together.

---

## Internal split

| | A1 (Discovery) | A2 (Planning + Framework + Orchestrator) |
|---|---|---|
| Hours 0–2 | Review the shared framework as A2 builds it | **Lead the contract freeze** (30-min team walkthrough, then lock 5 schemas). Commit `fixtures/` |
| Hours 2–8 | Build scanner against fixtures | Build `agents/common/`. Build fleet generator v1 (1,000 records) |
| Hours 8–20 | Switch to real cross-account scan; build real dependency graph; synthetic ingest at scale | Build the Planning agent itself |
| Hours 20–32 | Hand agent to A2 for orchestrator wiring; support integration | Wire the orchestrator so the full chain runs as one pipeline, SSE live to UI; **integration captain** — pull in A3/A4's real agents |
| Hours 32–48 | Hardening, rehearsal | Integration captain through first full dry run and rehearsals; keep `STATUS.md` current |

**Why this pairing:** Discovery feeds Planning directly (`AppRecord[]`, `Tiering[]`, edges → `WavePlan`), so they're already a pipeline pair. Planning is deliberately rule-based and fast specifically to leave A2 with slack for the framework and integration work — that's not incidental, it's the reason this track can absorb 4 sub-jobs instead of 1.

---

## The one deadline this whole 6-person team hangs off

**Hour 2: contract freeze.** This track owns it. After hour 2, the 5 schemas below can't change without A2's sign-off plus the affected track's. If this slips, Track 1 and Track 3 lose the ability to build in parallel — this is the single point of failure in the entire plan.

```
AppRecord   — Discovery's output, everyone's input
Tiering     — Discovery's output
WavePlan    — Planning's output, Track 3's input
BlueprintResult — Track 3 (Blueprint) output, Track 3 (Cutover) input
CutoverRun  — Track 3 (Cutover) output
```

Full JSON shapes (unchanged from the original contracts doc):

```json
// AppRecord
{
  "app_id": "app-orders", "source": "real", "name": "Orders API",
  "owner": "team-commerce", "business_unit": "Retail",
  "runtime": {"type": "ec2", "instance_ids": ["i-0abc"], "ami_id": "ami-0old",
              "ami_age_days": 912, "instance_type": "t3.micro", "port": 8080, "stateful": false},
  "network": {"vpc_id": "vpc-legacy", "subnet_public": true, "public_ip": true,
              "private_ip": "10.10.1.23",
              "sg_ingress": [{"port": 22, "cidr": "0.0.0.0/0"}, {"port": 8080, "cidr": "0.0.0.0/0"}]},
  "storage": {"ebs_encrypted": false, "volume_gb": 8},
  "metadata": {"imds_v2_required": false},
  "config": {"env": {"PRICING_URL": "http://10.10.1.40:8080"}},
  "depends_on": ["app-pricing"], "tags": {"depends-on": "app-pricing"},
  "findings": ["SG_OPEN_SSH", "SG_OPEN_APP", "EBS_UNENCRYPTED", "IMDSV1", "OLD_AMI", "PUBLIC_IP", "MISSING_TAGS"],
  "status": "DISCOVERED"
}
```

```json
// Tiering
{"app_id": "app-orders", "tier": "GOLDEN", "score": 84,
 "reasons": ["stateless", "matches golden_app pattern", "all findings auto-fixable"],
 "risk_summary": "Publicly exposed with SSH open; fixes are standard and automatable.",
 "decided_by": "rules"}
```

```json
// WavePlan
{"plan_id": "plan-001", "generated_at": "2026-10-03T10:00:00Z",
 "capacity_per_wave": 40, "waves_per_week": 3,
 "waves": [
   {"wave": 0, "name": "Pilot", "start": "2026-10-05",
    "app_ids": ["app-catalog", "app-pricing", "app-orders"],
    "tier_mix": {"GOLDEN": 3}, "rationale": "Real pilot apps; providers first."},
   {"wave": 1, "start": "2026-10-07", "app_ids": ["syn-00012"], "tier_mix": {"GOLDEN": 40}}
 ],
 "parked": ["syn-00991"],
 "projection": {"apps_total": 1003, "apps_schedulable": 871, "projected_finish": "2027-09-14",
                "apps_per_day": 5.7, "meets_target_2027": true}}
```

## Shared framework (`agents/common/`) — both tracks 2 and 3 build inside this

```
agents/common/
├── llm.py      # Bedrock client wrapper + fallback to Anthropic API
├── tools.py    # @tool decorator, registry, arg validation, allowlist guard
├── loop.py     # run_agent(system, user, tools, max_turns) tool-calling loop
├── models.py   # Pydantic models from the contracts above
├── store.py    # SQLite: apps, tiers, edges, waves, blueprints, cutovers, events
├── events.py   # emit(agent, app_id, type, payload)
└── aws.py      # sessions: target(), legacy() via AssumeRole
```

Rules every agent (in both tracks) follows: deterministic first, LLM second — must produce a usable result with `LLM_BACKEND=off`; structured output only, forced through a tool call and Pydantic-validated; mutating tools guarded to Account B resources tagged `managed-by=migration-accelerator`; every meaningful step emits an event; every agent is idempotent (upsert, not insert); every LLM call has a 20s timeout with a rules fallback.

---

## A1's job: Discovery

**Input:** legacy account (via AssumeRole) + `data/fleet.json`. **Output:** `AppRecord[]`, `Tiering[]`, dependency edges.

Scan (EC2, SGs, volumes, images, SSM params) → normalize → run 9 finding rules (`SG_OPEN_SSH`, `SG_OPEN_APP`, `EBS_UNENCRYPTED`, `IMDSV1`, `OLD_AMI`, `PUBLIC_IP`, `MISSING_TAGS`, `HARDCODED_IP`, `STATEFUL`) → map dependencies 3 ways (tag, SSM/env value, SG reference) → ingest synthetic fleet through the *same* logic → tier (rules first, score-based: start 100, deduct for stateful/-60, unknown runtime/-40, >5 deps/-15, hardcoded IP/-10, each unfixable finding/-10; GOLDEN ≥75, GRAY 40–74, RED <40 or stateful; borderline ±5 goes to Claude).

Target distribution on the synthetic fleet: ~60% Golden / 25% Gray / 15% Red. Performance: real scan <10s, synthetic tiering <3s, batch `APP_DISCOVERED` events by 50.

## A2's job: Planning + synthetic data + orchestrator

**Planning** — input `AppRecord[]`/`Tiering[]`/edges, output `WavePlan`. Deliberately rule-based: exclude Red → build dependency graph → break cycles into move-together units → cluster small tightly-coupled groups → topological sort (providers before consumers) → pack waves (Wave 0 = the 3 real apps, always) respecting `capacity_per_wave` → schedule with freeze windows → project finish date and `apps_per_day`. Optional LLM rationale text, template-string fallback. Must plan 1,000 apps in <1s without the LLM.

**Synthetic fleet generator** — `python data/generate_fleet.py --count 1000 --seed 42`. Fixed seed always. Faker for names/teams, scale-free dependency graph (`barabasi_albert_graph`), tuned finding probabilities to land ~60/25/15 after A1's tiering.

**Orchestrator API** — `POST /runs/{discovery,planning,blueprint/{id},cutover/{id},wave/{n}}`, `GET /apps`, `/plan`, `/blueprints/{id}`, `/cutovers/{id}`, `/events` (SSE), `POST /demo/bad-wave`, `POST /demo/reset`.

**Integration captain** — keeps `STATUS.md` (Working / Broken / Next) current continuously. Any blocker older than 30 minutes escalates here (agents questions) or to Track 1 (infra questions).

---

## Interface to the other two tracks

### What Track 2 needs, and from whom

| From | What | By hour | If late |
|---|---|---|---|
| Track 1 | `mig-discovery-readonly` role, tested | 8 | A1 stays on fixtures for the real-scan step only — keeps building everything else |
| Track 1 | 3 real legacy apps with genuine findings + dependencies | 8 | Same — validate against fixtures until then |
| Track 1 | Bedrock model ID once granted | ~12 (not blocking) | Default to `LLM_BACKEND=off` |

### What Track 2 delivers, and to whom

| To | What | By hour |
|---|---|---|
| Track 1 & 3 | Frozen contracts + fixtures | **2** — the hardest deadline on the team |
| Track 1 & 3 | `agents/common/` framework | 8 |
| Track 3 (Blueprint) | Real `AppRecord[]` per app | 20 |
| Track 3 (Cutover, via Blueprint) | Confirmed real cross-account discovery working | 20 |
| Track 1 (Dashboard) | Fixture-then-real data for Fleet/Dependencies/Plan tabs | 8 (fixtures), 20 (real) |

---

## Checkpoints this track owns

- **Hour 2:** Contract freeze — the hardest deadline on the whole team.
- **Checkpoint 1 (hour 8):** contracts frozen, fixtures committed, `fleet.json` generated, framework merged.
- **Checkpoint 2 (hour 20):** both agents run standalone from the CLI against real accounts.
- **Checkpoint 3 (hour 32):** orchestrator runs the full 4-agent chain live; `STATUS.md` current.

## Definition of Done

- [ ] Contracts frozen + fixtures committed by hour 2
- [ ] `agents/common/` merged and reviewed by Track 3 by hour 8
- [ ] Discovery: 3 real apps + correct edges; 1,000 synthetic apps tiered ~60/25/15; works with `LLM_BACKEND=off`
- [ ] Planning: 1,000 apps in <1s; no consumer scheduled before its provider; Wave 0 = the 3 real apps
- [ ] Orchestrator wires the full pipeline with live SSE
- [ ] `STATUS.md` kept current throughout; A2 and Track 1's C1 never sleep at the same time

## Cut list (in order, if behind)

1. VPC Flow Log dependency inference (A1) — tags + SG references only
2. LLM-written rationale text in Planning (A2) — template string instead
