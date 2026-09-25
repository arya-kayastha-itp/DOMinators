# Track 3 — Agents: Migration Execution

**Members:** A3, A4 (2 people). **Owns:** the Blueprint/IaC agent (with real Terraform apply) and the Cutover agent (with real traffic shifting and auto-rollback).

This track answers "now actually do it" — and it owns the two moments the demo is built around: the live config diff, and the live rollback. Fewer sub-jobs than Track 2, but each one is a high-stakes, judge-facing moment. That's the balance: Track 2 has breadth, this track has depth.

---

## Internal split

| | A3 (Blueprint/IaC) | A4 (Cutover) |
|---|---|---|
| Hours 0–2 | Review the shared framework as Track 2 builds it | Review the shared framework as Track 2 builds it |
| Hours 2–8 | Build against fixtures: map a legacy `AppRecord` → golden-module inputs | Build traffic generator + health model against fixtures |
| Hours 8–20 | Real LLM mapping once Bedrock confirmed; diff view; `terraform validate` passing | Real ALB weight shifting (manual CLI, then code); metric gates |
| Hours 20–26 | **Real `terraform apply`** into Account B | Auto-rollback logic + bad-wave scripted failure (coordinate with Track 1's C2) |
| Hours 26–32 | Diff view polish; support first full dry run | Support first full dry run |
| Hours 32–48 | Rehearsal, timing tuning | **Timing tuning** — land a clean cutover at 60–90s on stage; rehearsal |

**Why this pairing:** Blueprint's output (`BlueprintResult`, with target group ARNs) is Cutover's direct input — they're the second half of the same pipeline seam, same as Discovery→Planning is Track 2's internal seam. Both also share the bad-wave mechanism: A3 drops `PRICING_URL` from the generated inputs, A4's gate has to catch the resulting error spike. That coupling is exactly why they sit in one track instead of being split across two.

---

## A3's job: Blueprint Matching & IaC Generation

**Core idea — say this to judges if asked why the LLM doesn't write Terraform:** we don't generate infrastructure from scratch. Every app matches to a pattern already proven live in Account B (`golden_app`, built by Track 1). The agent's job is producing the right *inputs* to that pattern, never raw HCL.

Match → map inputs via LLM (`set_golden_inputs` tool call; rewrite legacy IPs to target-side names; fill tags from legacy record or `flag_gap`) → validate against Pydantic schema → render `generated/<app>/main.tf` from `templates/main.tf.j2` → build the before/after diff with fix annotations → `terraform init/validate/plan` → **apply** (real apps only) → for synthetic apps, dry-run only (steps 1–5).

Finding → fix map is fixed (matches Track 2's finding codes exactly): `SG_OPEN_SSH`→SSM Session Manager, `SG_OPEN_APP`→ALB-only ingress, `EBS_UNENCRYPTED`→KMS gp3, `IMDSV1`→`http_tokens=required`, `OLD_AMI`→latest AL2023 via SSM param, `PUBLIC_IP`→private subnet, `MISSING_TAGS`→enforced+flagged, `HARDCODED_IP`→rewritten to service names.

**Bad-wave role:** when `/demo/bad-wave` is on for `app-orders`, drop `PRICING_URL` from the inputs *after* validation — still valid Terraform, breaks at runtime.

**Demo timing:** pre-apply `app-pricing` and `app-orders` before judging; apply `app-catalog` live (under 90s), fall back to the pre-applied one if slow.

## A4's job: Cutover & Validation

Traffic generator (~20 req/s/app to the edge ALB, recording status/latency/served_by — this is the real-time source of truth, CloudWatch lags ~1 min) → weight controller (`elbv2.modify_rule`) → gate evaluator → explainer (LLM writes the summary *after* the decision; **the LLM never decides the rollback, code does, deterministically**).

```
precheck: tg-target all healthy? → else ABORT
for step in [10, 50, 100]:
    set weights (100-step, step); emit WEIGHT_SET
    wait observe_window (20s demo / 300s real)
    if gate fails: weights → (100,0); emit ROLLED_BACK; explain; return
    emit GATE_PASS
emit MIGRATED
```

Gates: `max_error_rate 0.02`, `max_p95_ms 800`, `min_target_share_ratio 0.8`, `require_healthy_targets true`.

**Rollback guarantees — non-negotiable:** under 2 seconds from gate failure to weights restored; a `finally`-style path resets weights to `100/0` on any crash/timeout/Ctrl-C mid-cutover (test this explicitly by killing the process); idempotent; target instances kept (not torn down) for debugging after rollback.

**Bad-wave role:** your gate has to catch a 5xx spike from `app-orders` within one observe window, snap weights back to `100/0` in ~1s, and hand the LLM the metrics for the plain-English explanation. Test this scenario 3+ times before the demo — it's on the "never cut" list.

---

## Interface to the other two tracks

### What Track 3 needs, and from whom

| From | What | By hour | If late |
|---|---|---|---|
| Track 2 | `agents/common/` + fixtures | 2 | Hard blocker — this is the one dependency you can't build around |
| Track 1 | Golden module's variable schema | 10 | Mock it from the architecture spec until confirmed — don't idle |
| Track 1 | Edge ALB: `listener_rule_arn`, `tg-<app>-target`, `tg-<app>-legacy` per app | 12 | Build/test weight-flip logic against a mocked ALB response |
| Track 1 | Terraform state backend (bootstrap) | 20 | Stay in `validate`-only mode, no real apply |
| Track 1 | `app-orders` correctly returning 500 on `/` (not a crash, not a failed health check) when `PRICING_URL` missing | 16 | Coordinate explicitly — the gate needs a clean error-rate signal, not a health-check failure |
| Track 2 | Real `AppRecord[]` per app | 20 | Develop against fixture `AppRecord`s until then |

### What Track 3 delivers, and to whom

| To | What | By hour |
|---|---|---|
| Track 1 (Dashboard) | Diff JSON shape (Blueprint tab), cutover event/traffic shape (Cutover tab) | 2 (frozen), real data by 24–26 |
| Track 2 (Orchestrator) | Both agents callable from CLI and from the orchestrator | 20 |
| Everyone | Confirmed bad-wave rollback fires reliably, no human input | 32 (Checkpoint 3) |

Internally: A3 → A4 is the tightest coupling on the team — `BlueprintResult` with real target group ARNs must land with A4 by hour 20–26 or Cutover has nothing real to shift traffic on.

---

## Checkpoints this track owns

- **Checkpoint 2 (hour 20):** both agents run standalone from the CLI against real accounts; `terraform validate` passes for all 3 real apps; manual ALB weight shifting works.
- **Checkpoint 3 (hour 32):** real Terraform apply works from the dashboard; bad wave rolls back automatically with zero human input — this is the one everyone remembers.
- **Hours 32–40:** dedicated timing-tuning window for A4 — protect this, it's what makes the demo feel rehearsed instead of janky.

## Definition of Done

- [ ] All 3 real apps apply cleanly, turn healthy in `tg-target`
- [ ] Diff view shows ≥6 annotated fixes per real app
- [ ] 1,000 synthetic dry runs finish in <30s, zero render errors
- [ ] Both agents produce usable results with `LLM_BACKEND=off`
- [ ] Clean cutover of `app-catalog` lands at 60–90s on stage
- [ ] Bad wave on `app-orders` auto-rolls-back within one observe window, verified 3+ times
- [ ] Killing the cutover process mid-run leaves weights at `100/0` — tested explicitly

## Never cut, no matter how far behind

The live config diff and the live traffic shift + auto-rollback. If behind, cut the 10% step first (go straight 0→50→100) before ever touching rollback. Cut the live `terraform apply` on stage (show pre-applied) before cutting the diff itself.
