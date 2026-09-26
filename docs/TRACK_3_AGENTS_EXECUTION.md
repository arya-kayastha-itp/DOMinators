# Track 3 — Agents: Migration Execution

**Members:** A3, A4. **Owns:** the Blueprint/IaC agent (real `terraform apply` into
Account B) and the Cutover agent (traffic generator, real ALB weight shifting, gates,
auto-rollback). This track owns the two moments the demo is built around: **the live
config diff** and **the live rollback**.

**What changed from the original plan:** Account B is live, so there's nothing left to
mock about the target side — `target_outputs.json` has every ARN you need. What's
new: a **local fake ALB harness** so A4 never waits for A3, two IAM fixes you depend
on (T1-1, T1-2 in [Track 1](TRACK_1_CLOUD.md)), and the fact that the app reads
`UPSTREAM_URL`, not `PRICING_URL` (see the CONTRACTS addendum).

All paths are relative to the repo root.
Clock: H0 = kickoff of this phase. Gates: G0 H+2, G1 H+8, G2 H+16, G3 H+24.

---

## Internal split and schedule

| | A3 — Blueprint/IaC | A4 — Cutover |
|---|---|---|
| **H0–2** | Review `models.py`; write the `GoldenInputs` schema mirroring `modules/golden_app/variables.tf`; co-write `fixtures/blueprint_app-catalog.json` with A2 | Co-write the cutover/traffic fixtures with A2; start the fake ALB harness |
| **H2–8** | Rules mapper → validator → `main.tf.j2` render → diff builder → `terraform validate` (local, `-backend=false`), all on fixtures, `LLM_BACKEND=off` | Fake ALB harness done; traffic generator; gate evaluator (unit-tested); controller with rollback + **kill test** — all on the fake |
| **H8–12** | LLM mapper through `loop.py` (mock → Bedrock); synthetic dry-run at scale; `plan` against the real backend (after T1-2) | Real `weights.py` against the live ALB (after T1-1): no-op 100/0 write + read-back on the `app-catalog` rule; heartbeat for the watchdog |
| **H12–16** | **Real apply of `app-catalog` by H+14**, healthy in `tg-app-catalog-target` → hand the `BlueprintResult` to A4; then `app-pricing` | **First real cutover of `app-catalog`** (H+14–16) with the real traffic generator |
| **H16–24** | Apply `app-orders` in its bad-wave variant; "Fix & retry" path; diff polish with C2 | Bad-wave rollback on the real `app-orders`, verified 3×; LLM explainer; synthetic wave simulation |
| **H24–30** | Support the G3 dry run; apply timing | Support the G3 dry run |
| **H30–36** | Rehearsal; pre-apply pricing + orders before judging | **Timing tuning** — land a clean cutover at 60–90 s; rehearsal |

**Why this pairing:** `BlueprintResult` (with real target-group ARNs) is Cutover's
direct input, and both halves share the bad-wave mechanism — A3 ships the broken
config, A4's gate must catch it.

---

## A3's job: Blueprint Matching & IaC Generation

**Core idea (say this to judges):** the LLM never writes Terraform. Every app matches
to `golden_app`, already proven live by `app-hello`. The agent only produces the
*inputs* to that pattern, which are schema-validated, and code renders the HCL.

### Tasks

| ID | Task |
|---|---|
| T3-B-1 | `schema.py` — `GoldenInputs` (Pydantic) mirroring the module's LLM-fillable vars: `name`, `port:int`, `instance_type ∈ {t3.micro, t3.small}`, `env: dict[str,str]`, `tags` must contain `owner`, `cost-center`, `data-class`. Extra validator: **no IP literals in `env` values** (a leftover `10.10.x.x` fails validation) |
| T3-B-2 | `mapper_rules.py` — the `LLM_BACKEND=off` mapper: `port` from `runtime.port`; `instance_type` = legacy type if allowlisted, else `t3.micro`; for each config value that points at a provider (IP → app via the edges / IP map): `UPSTREAM_URL=http://<alb_dns_name>/<provider-prefix>/` + `REQUIRE_UPSTREAM=1`; tags copied from legacy, else safe defaults + `flag_gap` |
| T3-B-3 | `mapper_llm.py` — tools `set_golden_inputs`, `flag_gap`, `lookup_target_endpoint` via `loop.py`; validate → retry once → fall back to the rules mapper (emit `LLM_FALLBACK`) |
| T3-B-4 | `templates/main.tf.j2` → `generated/<app>/main.tf`: S3 backend (`mig-tfstate-408336117553`, key `generated/<app>/terraform.tfstate`, `mig-tfstate-lock`, `ap-south-1`), provider, one `module "app"` with `source = "../../infra/terraform/modules/golden_app"`. Wiring vars come **only** from `target_outputs.json`: `target_group_arn = target_group_arns[app]`, `vpc_id`, `private_subnet_ids`, `path_prefix` (from `app_routes`, T1-4; fallback `/` + app_id without `app-`) |
| T3-B-5 | `diff.py` — before = readable legacy summary (SG rules, encryption, IMDS, AMI + age, subnet/public IP, tags, env with IPs); after = generated `main.tf` + the module's fixed hardening block; `annotations[]` mapping every finding to a fix and line numbers. ≥ 7 annotated fixes per real app |
| T3-B-6 | `terraform.py` — subprocess runner: `init -input=false`, `validate -json`, `plan -out=plan.out`, `show -json` → plan summary, `apply plan.out`. Streams lines as events. Uses `aws.tf_apply_env()` credentials. Shared `TF_PLUGIN_CACHE_DIR` so `init` doesn't re-download the provider |
| T3-B-7 | After apply, poll `describe_target_health` on `tg-<app>-target` until healthy (timeout 180 s); fill `outputs` (`instance_ids`, `tg_target_arn`, `tg_legacy_arn`, `listener_rule_arn` — all from `target_outputs.json`); emit `PROVISIONED`, else `BLUEPRINT_FAILED` |
| T3-B-8 | Bad wave: if the store flag `bad_wave:app-orders` is on, drop `UPSTREAM_URL` **after** validation and keep `REQUIRE_UPSTREAM=1` → valid Terraform, `/` returns 500, `/health` stays 200 |
| T3-B-9 | "Fix & retry": re-run with the flag off and apply with **`-replace=module.app.aws_instance.this`**. Changing `user_data` alone would only stop/start the instance, and user-data doesn't re-run on a restart, so the fix would silently not take effect. (Alternative: C1 adds `user_data_replace_on_change = true` to `golden_app`) |
| T3-B-10 | Synthetic apps: steps 1–5 only (map → validate → render → diff, no terraform) — 1,000 in < 30 s, zero render errors; emit `BLUEPRINT_DRY_RUN` (batched) |
| T3-B-11 | `run(app_id, apply)` + CLI `python -m agents.blueprint --app app-catalog [--apply]`; statuses `BLUEPRINTED` → `PROVISIONED` / `FAILED` |

### Finding → fix map (fixed; matches Track 2's codes)

`SG_OPEN_SSH` → no port 22, SSM Session Manager · `SG_OPEN_APP` → ingress from the
edge ALB SG only · `EBS_UNENCRYPTED` → KMS gp3 (`alias/mig-ebs`) · `IMDSV1` →
`http_tokens = "required"` · `OLD_AMI` → latest AL2023 via SSM parameter ·
`NO_VPC_SEGMENTATION` → target VPC's private tier · `PUBLIC_IP` → private subnet, no
public IP · `MISSING_TAGS` → enforced + gaps flagged · `HARDCODED_IP` → `UPSTREAM_URL`
rewritten to the ALB path.

**Cross-environment calls:** a migrated `app-orders` calls `http://<alb>/pricing/`
through the NAT. While pricing is still 100/0 that reaches *legacy* pricing over
peering — say so if asked; it's why ordering matters less.

**Demo timing:** pre-apply `app-pricing` and `app-orders` (bad variant) before judging;
pre-run `terraform init` for all 3; apply `app-catalog` live (< 90 s, boot + 2 health
checks). Fall back to a pre-applied copy if it's slow.

---

## A4's job: Cutover & Validation

**The LLM never decides the rollback — code does, deterministically.** Claude only
writes the explanation afterwards.

### Tasks

| ID | Task |
|---|---|
| T3-C-1 | **Fake ALB harness** `agents/cutover/fake_alb.py`: starts `app/server.py` twice locally (`SERVED_BY=legacy` / `target`; the "bad" target = `REQUIRE_UPSTREAM=1` with no `UPSTREAM_URL`) plus a weighted reverse proxy, and a `FakeElbClient` with the same interface as `weights.py`. Lets you build and test everything below without AWS or A3 |
| T3-C-2 | `traffic.py` — long-running async generator, ~20 req/s per app to `http://<alb>/<prefix>/`, records `TrafficSample` (status, latency, top-level `served_by`) in batches every 250 ms. Base URL from config (fake or real). Started once before the demo (by the orchestrator at boot, or by hand) |
| T3-C-3 | `weights.py` — `set_weights(app, target_pct)` via `elbv2.modify_rule` (forward action with both TGs), `get_weights(app)` via `describe_rules`; ARNs only from `target_outputs.json`; guarded by `assert_managed`; uses the `agent_runner()` session (needs T1-1) |
| T3-C-4 | `gates.py` — pure `evaluate(samples, weight, cfg) -> GateResult{pass, reasons, metrics}`: `max_error_rate 0.02`, `max_p95_ms 800`, `min_target_share_ratio 0.8`, `require_healthy_targets`, `min_requests 50`. Ignore the first ~2 s after each `WEIGHT_SET` (settle time). Also report error rate *per side* for the explanation |
| T3-C-5 | `controller.py` — precheck (all `tg-target` healthy, else `CUTOVER_ABORTED`, weights untouched) → for step in `[10, 50, 100]`: set weights, `WEIGHT_SET`, observe window (20 s demo / 300 s real), gate → `GATE_PASS` or rollback → `MIGRATED` + `SIM_DECOMMISSION` |
| T3-C-6 | Rollback path: one `modify_rule` to 100/0 in < 2 s; in `try/finally` + SIGINT/SIGTERM/atexit handlers; idempotent; target instances kept; `GATE_FAIL`, `ROLLED_BACK{reason, metrics}` |
| T3-C-7 | Heartbeat: while cutting over, write `cutover_heartbeat:<app>` to the store every 1 s. C1's orchestrator watchdog resets weights to 100/0 if it goes stale > 5 s — this covers a hard kill (`kill -9` / `taskkill /F`), where no `finally` can run |
| T3-C-8 | Explainer — after the decision, `llm` gets the metrics + recent events → one sentence ("Rolled back at 10%: 38% 5xx from target, `UPSTREAM_URL` missing on app-orders"); template fallback |
| T3-C-9 | Synthetic wave simulation — timed events, seeded ~3% random rollbacks, so wave 1 looks like a real batch while only `app-orders` really moves |
| T3-C-10 | `run(app_id)` + CLI `python -m agents.cutover --app app-catalog`; `agents/cutover/config.yaml`; statuses `CUTTING_OVER` → `MIGRATED` / `ROLLED_BACK` |

```
precheck: tg-target all healthy? → else ABORT (weights untouched)
for step in [10, 50, 100]:
    set weights (100-step, step); emit WEIGHT_SET; heartbeat
    wait observe_window (skip settle)
    if gate fails: weights → (100,0); emit GATE_FAIL, ROLLED_BACK; explain; return
    emit GATE_PASS
emit MIGRATED; emit SIM_DECOMMISSION
finally: if not MIGRATED → weights (100,0)
```

**Rollback guarantees — non-negotiable:** < 2 s from gate failure to weights
restored; any crash/timeout/Ctrl-C resets to 100/0 (tested by killing the process —
**on the actual demo host OS**, since signal handling differs on Windows); a hard
kill is covered by the watchdog; idempotent; target instances kept for debugging.

---

## Interface to the other tracks

### What Track 3 needs

| From | What | By | If late |
|---|---|---|---|
| Track 2 (A2) | G0 models + fixtures | H+2 | Hard blocker — the one thing you can't build around; help A2 finish it |
| Track 4 (C1) | `llm.py` / `loop.py` / `tools.py` (`off` + `mock`) | H+4 | Rules mapper + template explainer, which are required anyway |
| Track 4 (C1) | **T1-1** (ALB rule tags + Describe perms for `mig-agent-runner`) | H+6 | A4 stays on the fake ALB; use the admin `mig-target` profile only to confirm the mechanics |
| Track 4 (C1) | **T1-2** (`mig-tf-apply` PassRole) + T1-4 (`app_routes` output) | H+6 | A3 stays at `plan`; path prefix from the naming convention |
| Track 4 (C1) | Orchestrator watchdog for stale cutover heartbeats | H+16 | `make demo-reset` is the manual fallback |
| Track 2 (A1) | Real `AppRecord`s for the 3 apps | H+12 | Fixture `AppRecord`s were hand-written from the live account, so they're close |

### What Track 3 delivers

| To | What | By |
|---|---|---|
| Track 4 (C2) | Diff JSON (with annotations) and traffic/cutover shapes, frozen | H+2 (G0) |
| Track 4 (C1) | `blueprint.run` / `cutover.run` on fixtures; traffic generator runnable as a background task | H+8 |
| Track 4 (C1/C2) | Both agents on real AWS, callable from the orchestrator | H+16 |
| Everyone | Bad-wave rollback fires reliably with no human input | H+24 (G3) |

Internally: A3 → A4 real `BlueprintResult` for `app-catalog` by **H+14**. Until then
A4 is fully unblocked by the fake ALB.

## Definition of Done

- [ ] All 3 real apps apply cleanly and turn healthy in `tg-<app>-target`
- [ ] Diff view shows ≥ 7 annotated fixes per real app
- [ ] 1,000 synthetic dry runs in < 30 s, zero render errors
- [ ] Both agents produce usable results with `LLM_BACKEND=off`
- [ ] Clean cutover of `app-catalog` lands at 60–90 s, traffic share visibly following the weights
- [ ] Bad wave on `app-orders` auto-rolls-back within one observe window, verified 3+ times
- [ ] Killing the cutover process mid-run (soft **and** hard kill) leaves weights at 100/0
- [ ] "Fix & retry" actually replaces the instance and the retried cutover goes green

## Never cut, no matter how far behind

The live config diff and the live traffic shift + auto-rollback. If behind, cut the
10% step first (0 → 50 → 100) before ever touching rollback. Cut the live
`terraform apply` on stage (show pre-applied) before cutting the diff itself.
