# Track 2 — Agents: Intelligence & Framework Core

**Members:** A1, A2. **Owns:** the contract freeze (G0), `fixtures/`, the framework
core (`agents/common/models.py`, `store.py`, `events.py`, `aws.py`), the Discovery
agent, the Planning agent, the synthetic fleet generator, and integration-captain duty.

**What changed from the original plan:** the cloud is done, so this track now
builds against a *live* Account A from G2. The **orchestrator API moved to Track 4
(C1)**, and so did `llm.py` / `tools.py` / `loop.py`. That frees A2 to own the
contract freeze, Planning and integration without being the bottleneck for everything.

All paths are relative to the repo root (see the delegation map).
Clock: H0 = kickoff of this phase. Gates: G0 H+2, G1 H+8, G2 H+16, G3 H+24.

---

## Internal split and schedule

| | A1 — Discovery (+ `aws.py`) | A2 — Contracts, store, Planning, fleet, integration |
|---|---|---|
| **H0–2** | `agents/common/aws.py` signatures + two-hop session. Review `models.py` | **Lead G0**: `models.py`, store/events signatures, agent entry-point stubs, `fixtures/` — walk all 6 people through it in 30 min |
| **H2–8** | Scanner against recorded AWS responses → rules → dependencies → tiering, all with `LLM_BACKEND=off`; CLI | `store.py` + `events.py` implemented; fleet generator v1; Planning v1 on fixtures |
| **H8–12** | Real scan of Account A (needs T1-5 access). Hand real `AppRecord`s to A3 by **H+12** | Planning complete + tests; tune the fleet generator against A1's tiering to land ~60/25/15 |
| **H12–16** | Synthetic ingest at scale; LLM borderline tiering (once Bedrock is ready); event batching | Optional LLM rationale; pair with C1 to wire Discovery + Planning into the orchestrator |
| **H16–24** | Support integration; review the Fleet + Dependencies tabs with C2 | **Integration captain** through the G3 dry run; `STATUS.md` current |
| **H24–36** | Hardening; Flow-Log stretch only if everything else is green | Rehearsals; triage "must fix" vs. "narrate around" |

**Why this pairing still works:** Discovery → Planning is one pipeline seam
(`AppRecord[]`, `Tiering[]`, `Edge[]` → `WavePlan`), and Planning stays
rule-based and fast on purpose, leaving A2 slack for G0 and integration.

---

## G0 — the contract freeze (H+2, A2 leads) — the one deadline that must not slip

Everything in [CONTRACTS.md](CONTRACTS.md) **including the addendum** becomes code
and fixtures. After G0, a shape change needs A2's sign-off plus the affected owner,
plus a fixture update in the same PR.

| ID | Deliverable | Notes |
|---|---|---|
| T2-G0-1 | `agents/common/models.py` (Pydantic v2) | `AppRecord`, `Tiering`, `Edge`, `WavePlan`, `BlueprintResult` (with `diff.annotations`), `CutoverRun`, `Event`, `TrafficSample`, `DiscoverySummary`. Enums for tier, status, event type, finding code |
| T2-G0-2 | `store.py` + `events.py` **signatures** (bodies may be `NotImplementedError` at G0) | Exactly the store API in the CONTRACTS addendum |
| T2-G0-3 | Agent entry-point stubs | `agents/{discovery,planning,blueprint,cutover}/__init__.py: run(...)` returning fixture objects, so C1 can wire the orchestrator immediately |
| T2-G0-4 | `fixtures/` | `apps.json` (3 real apps, hand-written from the live account: private IPs `10.10.1.61` catalog, `10.10.1.138` pricing, `10.10.1.30` orders, the real AMI, real SG rules, SSM values), `tiers.json`, `edges.json`, `plan.json`, `summary.json`, plus — co-written with A3/A4 — `blueprint_app-catalog.json`, `cutover_app-catalog.json` (MIGRATED), `cutover_app-orders.json` (ROLLED_BACK), `traffic_app-orders.json`, and `events.jsonl` (a scripted ~60-event demo run for C1's stub orchestrator and C2's dashboard) |
| T2-G0-5 | `agents/common/aws.py` signatures (A1) | `target()`, `agent_runner()`, `legacy()`, `tf_apply_env()`, `target_outputs()` |
| T2-G0-6 | Decisions D1 + D2 below, written into the fixtures | |

### Decisions to settle at G0 (recommendations given)

- **D1 — `HARDCODED_IP` on `app-pricing`.** `/legacy/app-pricing/CATALOG_URL` contains an IP, so the literal rule fires on pricing too, although the docs list it only for orders. **Recommend: accept it** — it's genuinely true of the account. Update `Cloud_ENVIRONMENTS.md` §4 in the same PR.
- **D2 — do `MISSING_TAGS` apps go Gray?** The tiering rule says "a fix needing a human decision (unknown `cost-center`) → GRAY", which would make pricing and orders Gray, but the contracts show all 3 real apps Golden. **Recommend:** `MISSING_TAGS` is auto-fixable with a flagged gap (Blueprint defaults + `flag_gap`), so it doesn't force Gray on its own. The "human decision" trigger applies to things like `license=commercial` without BYOL, or non-EC2 runtimes (ecs/unknown) in the synthetic fleet. All 3 real apps end up GOLDEN.

---

## Framework core (both tracks and Track 4 build on this)

```
agents/common/
├── models.py   # A2 — Pydantic models from CONTRACTS.md (+ addendum)
├── store.py    # A2 — SQLite (WAL mode, one file, thread-safe): apps, tiers, edges, plans, blueprints, cutovers, traffic, events, flags
├── events.py   # A2 — emit()/events_since(); every emit also persists, orchestrator streams from the table
├── aws.py      # A1 — sessions + target_outputs() loader + assert_managed(arn) guard
├── llm.py      # C1 (Track 4) — Bedrock / Anthropic / off / mock backends, 20 s timeout
├── tools.py    # C1 (Track 4) — @tool registry, arg validation, allowlist guard (uses aws.assert_managed)
└── loop.py     # C1 (Track 4) — run_agent(system, user, tools, max_turns); emits TOOL_CALL / LLM_FALLBACK
```

| ID | Owner | Task | By |
|---|---|---|---|
| T2-FW-1 | A2 | `store.py` implemented + unit tests (idempotent upserts, `traffic_window`, `reset`) | H+5 |
| T2-FW-2 | A2 | `events.py` implemented (monotonic ids, JSON payloads, batch emit) | H+5 |
| T2-FW-3 | A1 | `aws.py`: `target()` from `TARGET_PROFILE`; `agent_runner()` assumes `AGENT_RUNNER_ROLE_ARN`; `legacy()` does the **two-hop** (runner → `LEGACY_ROLE_ARN` + `LEGACY_EXTERNAL_ID`) with credentials refreshed before the 1 h expiry; `tf_apply_env()` returns env vars for a terraform subprocess; `target_outputs()` reads `data/target_outputs.json` (cached); `assert_managed(arn)` checks the `managed-by=migration-accelerator` tag | H+4 |
| T2-FW-4 | A2 | `pytest agents/` runs on fixtures with `LLM_BACKEND=mock` in < 30 s | H+8 |

Rules every agent follows (unchanged): deterministic first, LLM second — must
produce a usable result with `LLM_BACKEND=off`; structured output only (forced tool
call, Pydantic-validated, retry once, then rules); mutating tools guarded to
Account B resources tagged `managed-by=migration-accelerator`; every meaningful step
emits an event; idempotent (upsert, never insert); every LLM call has a 20 s timeout
with a rules fallback. **No secrets in prompts or in the repo** — role ARNs,
ExternalId and model ID come from `.env`.

---

## A1's job: Discovery

**Input:** Account A via the two-hop role + `data/fleet.json`. **Output:** `AppRecord[]`,
`Tiering[]`, `Edge[]` in the store, `DiscoverySummary` in the `DISCOVERY_DONE` event.

### Tasks

| ID | Task |
|---|---|
| T2-D-1 | `scanner.py` — takes injected boto3 clients so it runs on **recorded responses** (`fixtures/aws/*.json`, via `botocore.Stubber`) before AWS access exists. Calls, all paginated: `describe_instances` (running only), `describe_security_groups`, `describe_volumes`, `describe_images(ImageIds=…, IncludeDeprecated=True)`, `describe_subnets`, `describe_route_tables`, `ssm.get_parameters_by_path("/legacy/", Recursive=True)` |
| T2-D-2 | `normalize.py` — one `AppRecord` per app, grouped by the `app` tag, **falling back to `Name`** (the live legacy apps only have `Name`). `config.env` built from `/legacy/<app>/<KEY>` SSM params |
| T2-D-3 | `rules.py` — the 10 finding rules as pure functions, each unit-tested (table below) |
| T2-D-4 | `deps.py` — union of 3 signals into `Edge{from, to, signals}` (consumer → provider): `depends-on` tag; SSM/env value containing another app's private IP or name; provider SG ingress whose source is the consumer's SG |
| T2-D-5 | `tiering.py` — score rules (start 100: `STATEFUL` −60, unknown runtime −40, > 5 deps −15, `HARDCODED_IP` −10, each non-auto-fixable finding −10; GOLDEN ≥ 75, GRAY 40–74, RED < 40 or stateful or unlicensed commercial). Borderline (±5 of a threshold) → Claude via `submit_tiering`, `decided_by=llm`; max 8 concurrent, 20 s timeout, rules on failure |
| T2-D-6 | `synthetic.py` — load `fleet.json` and run the **same** rules → deps → tiering (no scan) |
| T2-D-7 | `run(scope)` + CLI `python -m agents.discovery --scope real|synthetic|all`; events: `DISCOVERY_STARTED`, `APP_DISCOVERED` (per app for real, batches of 50 for synthetic), `DISCOVERY_DONE{summary}`; statuses → `TIERED` |
| T2-D-8 | Switch to the real account (H+8), then record the real responses into `fixtures/aws/` for regression tests |
| T2-D-9 | Oracle test: an integration test that compares computed findings with the legacy instances' `findings` tag. The tag is **never** an input to the rules |

### Finding rules — with the gotchas the live account actually has

| Code | Condition | Gotcha |
|---|---|---|
| `SG_OPEN_SSH` | Ingress on 22 from `0.0.0.0/0` | |
| `SG_OPEN_APP` | Ingress on the app port from `0.0.0.0/0` | App port = the port the SGs open other than 22 (8080) |
| `EBS_UNENCRYPTED` | Any attached volume `Encrypted=false` | |
| `IMDSV1` | `MetadataOptions.HttpTokens != "required"` | |
| `OLD_AMI` | AMI `CreationDate` > 365 days ago | **Must pass `IncludeDeprecated=True`** — the legacy AMI is deprecated and is otherwise invisible. If the image still can't be described, emit the finding with `ami_age_days: null` and a reason, never silently skip |
| `NO_VPC_SEGMENTATION` | No subnet in the VPC has an **effective** route table without a `0.0.0.0/0 → igw-*` route | Effective RT = the subnet's explicit association, else the VPC's main RT. The live VPC has an unused main RT with no IGW route — a naive "any RT without IGW" check wrongly says "segmented" |
| `PUBLIC_IP` | Instance has a public IP | |
| `MISSING_TAGS` | Any of `owner`, `cost-center`, `data-class` missing | Only `app-catalog` has them |
| `HARDCODED_IP` | A config value contains an IPv4 literal | Fires on orders **and** pricing (D1) |
| `STATEFUL` | DB port open, large extra EBS volume, or tag `stateful=true` | None of the 3 real apps |

**Expected for the 3 real apps (after D1/D2):** catalog = 7 baseline findings;
pricing = 7 + `MISSING_TAGS` + `HARDCODED_IP`; orders = 7 + `MISSING_TAGS` + `HARDCODED_IP`;
edges `orders → pricing → catalog`, each found by all 3 signals; all three GOLDEN.

### Performance
Real scan < 10 s. 1,000 synthetic apps rules-only < 3 s. ~50 borderline LLM calls, 8 concurrent.

---

## A2's job: Planning + synthetic fleet + integration captain

### Planning — `WavePlan` from `AppRecord[]` / `Tiering[]` / `Edge[]`

| ID | Task |
|---|---|
| T2-P-1 | Exclude Red → `PARKED` (with reasons) |
| T2-P-2 | `networkx.DiGraph` consumer → provider; strongly connected components become move-together units; small tight clusters (≤ 5) become units |
| T2-P-3 | Topological order, providers before consumers; pack waves: **Wave 0 = every real app that isn't parked**, providers first (today: catalog → pricing → orders → juice-shop; Gitea and Vaultwarden are stateful → Red → parked); then units in dependency order, Golden before Gray among the eligible ones (Gray counts as 2 slots); never split a unit; respect `capacity_per_wave` |
| T2-P-4 | Schedule `waves_per_week` from `start_date`, skipping the freeze window (15 Dec – 5 Jan); projection: `projected_finish`, `apps_per_day`, `meets_target_2027` |
| T2-P-5 | Optional LLM rationale per wave + overall; template-string fallback |
| T2-P-6 | `run()` + CLI `python -m agents.planning --capacity 40`; `PLAN_DONE` event; statuses → `PLANNED` / `PARKED` |
| T2-P-7 | Tests: 1,000 apps in < 1 s with LLM off; no consumer before its provider; Wave 0 = real apps; projection changes when capacity changes |

### Synthetic fleet — `python data/generate_fleet.py --count 1000 --seed 42 --out data/fleet.json`

| ID | Task |
|---|---|
| T2-F-1 | Generator v1: `syn-00001…`, Faker names, ~25 teams, business units, runtime mix (ec2 85 / ecs 10 / unknown 5), 12 % stateful, AMI age 30–1,400 days, license mix, scale-free `depends_on` (`barabasi_albert_graph`) |
| T2-F-2 | Emit **raw config fields** (SG rules, encryption, IMDS, tags, env values, route-table facts) and leave `findings` empty, so Discovery's own rules compute them — that's what makes "same logic for real and synthetic" true |
| T2-F-3 | Tune probabilities against A1's `tiering.py` until the fleet lands ~60/25/15; the script prints count, tier estimate, max in-degree, isolated apps, and checks there are no self/dangling dependencies |

### Integration captain

| ID | Task |
|---|---|
| T2-I-1 | `STATUS.md` (Working / Broken / Next), updated at every standup |
| T2-I-2 | Own the G3 dry run with C1: all 3 real apps end-to-end from the dashboard + bad wave; keep the bug list sorted "must fix" / "narrate around" |
| T2-I-3 | `scripts/e2e_real.sh` (with C1): Discovery → Planning → Blueprint `app-catalog` → Cutover, from the CLI, against real accounts |

---

## Interface to the other tracks

### What Track 2 needs

| From | What | By | If late |
|---|---|---|---|
| Track 4 (C1) | T1-5 — developer access to Account B (+ assume `mig-agent-runner`) | H+8 | A1 keeps building on recorded responses; only T2-D-8 waits |
| Track 4 (C1) | `llm.py` / `tools.py` / `loop.py` with `off` + `mock` backends | H+4 | Tiering and Planning run rules-only, which is required anyway |
| Track 4 (C1) | Bedrock model ID (T1-3) | not blocking | `LLM_BACKEND=off` |
| Track 3 | Review of the blueprint/cutover/traffic fixtures | H+2 | A2 writes them from CONTRACTS; A3/A4 fix them in their first PR |

### What Track 2 delivers

| To | What | By |
|---|---|---|
| Everyone | G0: models, store/events signatures, agent stubs, fixtures | **H+2** |
| Everyone | `store.py`, `events.py`, `aws.py` implemented | H+5 |
| Track 3 (A3) | Real `AppRecord`s for the 3 apps (in the store + refreshed `fixtures/apps.json`) | H+12 |
| Track 4 (C1) | `discovery.run` / `planning.run` working on fixtures | H+8; real H+16 |
| Track 4 (C2) | Real data behind `/apps`, `/edges`, `/tiers`, `/plan` | H+16 |

## Definition of Done

- [ ] G0 met at H+2: models, store/events signatures, stubs, fixtures merged; D1/D2 decided
- [ ] `store.py`, `events.py`, `aws.py` merged with tests; two-hop `legacy()` works against the live account
- [ ] Discovery: 3 real apps with the expected findings and edges (all 3 signals each); nothing hardcoded (renaming an app's `Name` tag still works); runs with `LLM_BACKEND=off`
- [ ] Discovery: 1,000 synthetic apps tiered ~60/25/15 in < 3 s rules-only
- [ ] Planning: 1,000 apps in < 1 s; no consumer before its provider; Wave 0 = the real apps that aren't parked
- [ ] `fleet.json` generated with a fixed seed; sanity checks pass
- [ ] `STATUS.md` kept current; A2 and C1 never offline at the same time

## Cut list (in order, if behind)

1. VPC Flow Log dependency inference (A1) — tags + SSM + SG references only
2. LLM-written rationale in Planning (A2) — template string
3. LLM borderline tiering (A1) — rules decide everything, `decided_by=rules`
