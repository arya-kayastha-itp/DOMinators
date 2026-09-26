# Development Checklist — Cloud Migration Accelerator

What's actually built vs. still to do. **"Done" means it exists in this repo, or,
for AWS resources, is live and was checked** — not just described in a doc.

**Keep this current:** per [AGENTS.md](AGENTS.md) rule 3, every push to a personal
branch and every PR updates this file in the same commit. Tick only what is done and
verified; add `[ ]` items for anything new you discover. Task IDs (T1-x, T2-x, …)
point to the track docs in [docs/](docs/00_DELEGATION_MAP.md).

_Last verified: 2026-09-26, against the repo, both setup records, and live `curl`
checks of the edge ALB._

---

## ✅ Done — Track 1 (Cloud)

### 1. Documentation alignment
- [x] `docs/Cloud_ENVIRONMENTS.md` reframed: `NO_VPC_SEGMENTATION` is the headline
      finding; `PUBLIC_IP` is the per-instance symptom
- [x] `ARCHITECTURE.md`, `CONTRACTS.md`, track docs, and the accelerator's agent
      READMEs aligned on finding codes, counts and fix maps
- [x] Two-real-AWS-accounts setup documented (§6 of `Cloud_ENVIRONMENTS.md`)
- [x] `infra/README.md`: `network` module `create_private_tier` toggle, NAT count and
      peering direction fixed
- [x] Pinned legacy AMI lookup documented (`--include-deprecated`, ACCOUNT_A_SETUP §2.4)
- [x] Full build records: `infra/cloudformation/legacy/ACCOUNT_A_SETUP.md` and
      `infra/terraform/ACCOUNT_B_SETUP.md`
- [x] Repo restructured: Account B Terraform, `app/`, `data/` and the agent/dashboard
      READMEs moved out of `docs/cloud-migration-accelerator/` to the repo root
      (`infra/terraform/` next to `infra/cloudformation/legacy/`); duplicate docs
      removed; `.gitignore` and all doc links updated

### 2. Terraform — Account B (`infra/terraform/`)
- [x] `bootstrap/` — S3 state bucket + DynamoDB lock table
- [x] `modules/network` — VPC, public/private tiers, IGW, NAT, `create_private_tier`
- [x] `modules/iam_cross_account` — `agent_runner` / `discovery_readonly` role types
- [x] `modules/golden_app` — hardened pattern Blueprint targets (AL2023 via SSM, KMS
      gp3, IMDSv2, SSM-only profile, ALB-only SG, `managed-by` tag)
- [x] `modules/edge_alb` — ALB + per-app weighted target groups (100/0)
- [x] `envs/target` — wires everything + golden shared resources + `app-hello`
- [x] Public route table: internet route moved from an inline `route` block to its own
      `aws_route.public_internet` (imported, state only) — the inline block was set to
      delete the standalone peering route on the next apply
- [x] `.gitattributes` pins `*.py` / `*.sh` / `*.tpl` / `*.yaml` to LF — Windows CRLF
      checkouts changed `app-hello`'s `user_data` hash and would break the shebang on
      new golden_app instances
- [x] `module "app_hello"` no longer uses a module-level `depends_on` (it deferred the
      AMI/KMS lookups and turned an ALB change into a forced replacement of the
      instance); value references keep fresh-build ordering
- [x] `edge_alb`: optional `listener_port` (own ALB listener, still one rule per app)
      and `health_path`; `golden_app`: `runtime` = `demo-server` | `juice-shop`
      (vetted template, Docker `bkimminich/juice-shop:v20.2.0`, host 8080 → 3000)
- [x] Juice Shop runtime smoke-tested live: temporary golden instance healthy in
      `tg-app-juice-shop-target`, then destroyed (2026-09-26)
- [x] Shared app code `app/server.py` (`SERVED_BY` env var is the only env difference;
      `REQUIRE_UPSTREAM=1` + no `UPSTREAM_URL` → 500 on `/`, 200 on `/health` — the
      bad-wave behaviour, in code)

### 3. Account A (legacy) — built with CloudFormation, not Terraform
- [x] AWS account created (`533266974611`, `ap-south-1`)
- [x] Templates in repo: `account-a-v2.yaml` (= `account-a-all-in-one.yaml`) plus the
      4 split stacks `01`–`04`
- [x] Stack deployed: VPC `vpc-0bc12dd6664275ce7` (`10.10.0.0/16`), no private tier
- [x] 3 apps running (`app-catalog` `10.10.1.61`, `app-pricing` `10.10.1.138`,
      `app-orders` `10.10.1.30`) — full chain verified through the ALB (§5)
- [x] Template configures all 9 finding codes (open 22/8080, unencrypted EBS,
      IMDSv1 `optional`, deprecated 2023 AMI, public subnets only, missing tags on
      pricing/orders, IPs in SSM)
- [x] Template configures 3-way dependencies (`depends-on` tag, `/legacy/*` SSM
      params, SG-to-SG ingress)
- [x] `mig-discovery-readonly` role deployed; trust + ExternalId fixed to match Account B
- [x] ~~`modules/legacy_app` + `envs/legacy` in Terraform~~ — superseded by the
      CloudFormation stack (decision recorded here; no Terraform needed)

### 4. Account B — live in AWS (`408336117553`, `ap-south-1`)
- [x] IAM user + CLI profile `mig-target`, AWS CLI v2 + Terraform installed (on the
      Account B owner's machine)
- [x] `bootstrap` applied — `mig-tfstate-408336117553`, `mig-tfstate-lock`
- [x] `envs/target` applied — 40 resources: VPC `10.20.0.0/16` with real tiering, NAT,
      edge ALB, 7 target groups, KMS key, `mig-golden-app` SG, `mig-app-instance`
      profile, `mig-agent-runner` / `mig-tf-apply` roles, `app-hello`
- [x] `data/target_outputs.json` generated (hand-off artifact for Blueprint/Cutover)
- [x] Smoke test of `/hello` — `GET /hello/` → 200 `served_by: target`,
      `/hello/health` → 200 (checked 2026-09-26)
- [x] Local checkout moved to `infra/terraform/` after the repo restructure: carried
      over `envs/target/backend-config.hcl`, `envs/target/terraform.tfvars` **and**
      `bootstrap/terraform.tfstate` (bootstrap's state is local); re-ran `init`;
      `terraform plan` → **No changes** in both `bootstrap` and `envs/target`; old folder
      deleted; `/orders/` and `/hello/` still 200 (2026-09-26)
- [x] `app-juice-shop` routing live: ALB listener `:3000`, `tg-app-juice-shop-legacy` /
      `-target` (health `/`, weights 100/0); ALB SG allows 3000

### 5. Cross-account wiring
- [x] VPC peering `pcx-0ae4efd1f16fc19be` — requested from B, accepted in A, `active`
- [x] Routes on both sides (A's return route added by hand to the associated RT)
- [x] Two-hop AssumeRole `mig-agent-runner` → `mig-discovery-readonly` works
- [x] Legacy IPs registered in `tg-<app>-legacy` (manual, `AvailabilityZone=all`),
      all healthy
- [x] End-to-end: `GET /orders/` through the ALB → 200, nested
      orders → pricing → catalog, all `served_by: legacy` (re-checked 2026-09-26)

---

## ⏳ To do

### 6. Cloud carry-over — Track 4 / C1 ([TRACK_1_CLOUD.md](docs/TRACK_1_CLOUD.md))
- [ ] T1-1 Tag ALB listener rules + unconditioned `elasticloadbalancing:Describe*` for
      `mig-agent-runner`; verify `modify-rule` / `describe-target-health` as that role
- [ ] T1-2 `iam:PassRole` (on `mig-app-instance`) + `iam:GetInstanceProfile` for
      `mig-tf-apply` — or record the decision to apply with the admin profile
- [ ] T1-3 Bedrock Claude access in `ap-south-1` confirmed with one call; `LLM_MODEL_ID` in `.env`
- [x] T1-4 `app_routes` output in `envs/target` (`path_prefix`, `priority`, `port`,
      `listener_port`, `health_path`, `runtime`); `data/target_outputs.json` re-exported
      **without a BOM** (the previous PowerShell export had one, which breaks Python's
      `json.load`); verified with `json.load`
- [ ] Juice Shop + Gitea deployed in Account A per `docs/ADDITIONAL_APPS.md` §1
      (Nancy / Arya / Palak) — change set must show exactly 4 `Add`, and
      `PeeringConnectionId` stays blank
- [ ] Legacy Juice Shop IP registered in `tg-app-juice-shop-legacy`
      (`AvailabilityZone=all`); `curl <alb>:3000/` → 200 via peering
- [ ] Track 2: Wave 0 / expected-findings tests updated for the 2 new apps
      (Juice Shop → Golden, Gitea → Red via `STATEFUL`)
- [ ] Track 3: Blueprint passes `app_routes[app].runtime` into `golden_app` and
      handles apps with a `listener_port` (no `path_prefix`)
- [ ] `envs/target` listener rules: `lifecycle { ignore_changes = [action] }` (or
      equivalent), otherwise the next `terraform apply` resets Cutover's weights to
      100/0 and silently undoes a migration
- [ ] Decide on AMI churn: golden_app reads "latest AL2023", so any apply after AWS
      publishes a new AMI replaces running golden instances (e.g. `ignore_changes =
      [ami]`, or pin per wave)
- [ ] Teammates with an existing Windows clone re-checkout `*.py` / `*.tpl` / `*.yaml`
      once so the new `.gitattributes` LF rule applies (see ACCOUNT_B_SETUP §3)
- [ ] T1-5 Every developer has CLI access to Account B + can assume `mig-agent-runner`;
      `.env.example` lists all required variables — `.env.example` part done; Track 2
      now runs from the Account B owner's machine (Hem can't install the AWS CLI), so
      per-developer access is only needed for whoever else runs agents against AWS
- [ ] T1-6 Account A drift reconciled (manual SG ingress + return route) — live stack
      matches the template
- [ ] T1-7 `scripts/register_legacy_targets.sh`
- [ ] T1-8 `make demo-reset` + `make demo-check`
- [ ] T1-9 Timed teardown/rebuild < 20 min; Budgets alarm in both accounts
- [ ] T1-10 Decide whether to rotate the ExternalId committed in ACCOUNT_B_SETUP.md
- [ ] All 9 findings confirmed present by an actual scan (closes with T2-D-8)
- [ ] Bad-wave behaviour verified live on a deployed target `app-orders` (closes with T3-B-8)

### 7. G0 contract freeze — Track 2 / A2 (+ A1) — **H+2**
- [x] T2-G0-1 `agents/common/models.py` (all CONTRACTS shapes + addendum). Additive,
      defaulted fields the Discovery rules need: `network.sg_ids`, `sg_ingress[].source_sg`
      (for the `sg_ref` signal), `storage.extra_volume_gb`, `license`,
      `runtime.ami_age_reason`, `GoldenInputs.runtime`
- [x] T2-G0-2 `store.py` / `events.py` — implemented, not just signatures (see §8)
- [x] T2-G0-3 Agent entry-point stubs for all 4 agents (`agents/{discovery,planning,
      blueprint,cutover}/__init__.py: run(...)`, exact addendum signatures, replay
      fixtures through the real store + events)
- [x] T2-G0-4 `fixtures/` (apps, tiers, edges, plan, summary, blueprint, cutovers,
      traffic, `events.jsonl` with 54 events) — built through the models from the live
      account; plus raw recorded responses in `fixtures/aws/` (3 original apps)
- [x] T2-G0-5 `aws.py` — implemented, not just signatures (see §8)
- [x] T2-G0-6 D1 accepted (`HARDCODED_IP` on pricing; `Cloud_ENVIRONMENTS.md` §4
      updated) and D2 accepted (`MISSING_TAGS` auto-fixable, all 3 real apps GOLDEN)
- [ ] Track 3 reviews `blueprint_app-catalog.json`, `cutover_*.json`,
      `traffic_app-orders.json` and fixes them in their first PR
- [ ] Re-record `fixtures/aws/` and extend `fixtures/apps.json` etc. with
      `app-juice-shop` / `app-gitea` once Account A testing finishes (both are live, but
      deliberately left out of the fixtures while they're being tested)

### 8. Shared framework
- [x] T2-FW-1 `store.py` implemented + tests (idempotent upserts, `set_status`,
      `traffic_window`, flags, `reset`); connection setup serialized after the
      threaded test caught a real "database is locked" race
- [x] T2-FW-2 `events.py` implemented (monotonic ids, JSON payloads, `emit_batch`,
      `events_since`; 100 concurrent emits from 4 threads keep unique ids, 5/5 runs)
- [x] T2-FW-3 `aws.py` implemented; two-hop `legacy()` verified live (recorded Account A
      through `mig-agent-runner` → `mig-discovery-readonly`); self-refreshing creds;
      scan scoped by `LEGACY_VPC_IDS` because Account A also runs unrelated workloads
- [x] T2-FW-4 `pytest` (20 tests) green on fixtures in < 10 s — no LLM code exists yet,
      so `LLM_BACKEND=mock` coverage comes with T4-L-4
- [x] `requirements.txt` + `.env.example` section for the agents (T1-5's variables);
      local `.env` is gitignored
- [ ] Machine note: on the Account B owner's laptop, Python takes 26–36 s to load
      certifi's CA bundle, so boto3 connections went idle and were dropped
      (`SSL: UNEXPECTED_EOF`). Worked around with `AWS_CA_BUNDLE` → a 5-cert Amazon-roots
      PEM (verification still on). Worth checking whether endpoint security causes it
- [ ] T4-L-1 `llm.py` (bedrock / anthropic / off / mock, 20 s timeout) (C1)
- [ ] T4-L-2 `tools.py` (registry, validation, allowlist guard) (C1)
- [ ] T4-L-3 `loop.py` (`TOOL_CALL` / `LLM_FALLBACK` events) (C1)
- [ ] T4-L-4 LLM plumbing tests + one live Bedrock smoke test (C1)

### 9. Discovery — Track 2 / A1
- [ ] T2-D-1 Scanner on recorded responses (`IncludeDeprecated=True`, paginated)
- [ ] T2-D-2 Normalize → `AppRecord` (group by `app` tag, fall back to `Name`)
- [ ] T2-D-3 10 finding rules + unit tests (effective-route-table check for
      `NO_VPC_SEGMENTATION`)
- [ ] T2-D-4 Dependency edges from 3 signals
- [ ] T2-D-5 Tiering rules + borderline LLM (`submit_tiering`)
- [ ] T2-D-6 Synthetic ingest through the same logic
- [ ] T2-D-7 `run()` + CLI + events (batched for synthetic)
- [ ] T2-D-8 Real scan of Account A; real responses recorded as fixtures
- [ ] T2-D-9 Oracle test vs. the legacy `findings` tag (never an input)

### 10. Planning + synthetic fleet + integration — Track 2 / A2
- [ ] T2-P-1…4 Park Red; graph + SCC units; topo order + wave packing (Wave 0 = the
      3 real apps); schedule + projection
- [ ] T2-P-5 Optional LLM rationale (template fallback)
- [ ] T2-P-6 `run()` + CLI + `PLAN_DONE`
- [ ] T2-P-7 Tests: 1,000 apps < 1 s, no consumer before provider, Wave 0 correct
- [ ] T2-F-1 `data/generate_fleet.py` v1 (seed 42)
- [ ] T2-F-2 Raw config fields only; findings computed by Discovery
- [ ] T2-F-3 Tuned to ~60/25/15; sanity checks printed
- [ ] T2-I-1 `STATUS.md` maintained
- [ ] T2-I-3 `scripts/e2e_real.sh`

### 11. Blueprint/IaC — Track 3 / A3
- [ ] T3-B-1 `GoldenInputs` schema (no IP literals in `env`)
- [ ] T3-B-2 Rules mapper (`UPSTREAM_URL` + `REQUIRE_UPSTREAM`, tags + gaps)
- [ ] T3-B-3 LLM mapper via `loop.py` with fallback
- [ ] T3-B-4 `templates/main.tf.j2` → `generated/<app>/main.tf` (wiring only from
      `target_outputs.json`)
- [ ] T3-B-5 Diff with ≥ 7 annotated fixes per real app
- [ ] T3-B-6 Terraform runner (init/validate/plan/apply, plugin cache)
- [ ] T3-B-7 Wait for target health; `PROVISIONED` / `BLUEPRINT_FAILED`
- [ ] T3-B-8 Bad-wave variant (drop `UPSTREAM_URL`, keep `REQUIRE_UPSTREAM=1`)
- [ ] T3-B-9 Fix & retry with `-replace` (or `user_data_replace_on_change`)
- [ ] T3-B-10 1,000 synthetic dry runs < 30 s
- [ ] T3-B-11 `run()` + CLI
- [ ] `app-catalog` applied + healthy in `tg-app-catalog-target`
- [ ] `app-pricing` applied + healthy
- [ ] `app-orders` applied (bad variant) + healthy on `/health`

### 12. Cutover — Track 3 / A4
- [ ] T3-C-1 Local fake ALB harness
- [ ] T3-C-2 Traffic generator (~20 req/s/app → `traffic` table)
- [ ] T3-C-3 `weights.py` against the live ALB rules
- [ ] T3-C-4 Gate evaluator + tests
- [ ] T3-C-5 Controller (precheck, 10/50/100, gates)
- [ ] T3-C-6 Rollback < 2 s in `finally` + signal handlers
- [ ] T3-C-7 Heartbeat for the orchestrator watchdog
- [ ] T3-C-8 LLM explainer (template fallback)
- [ ] T3-C-9 Synthetic wave simulation (~3% seeded rollbacks)
- [ ] T3-C-10 `run()` + CLI + `config.yaml`
- [ ] Clean real cutover of `app-catalog` in 60–90 s
- [ ] Bad wave on `app-orders` rolls back automatically — verified 3×
- [ ] Soft kill **and** hard kill mid-cutover leave weights at 100/0

### 13. Orchestrator (backend) — Track 4 / C1
- [ ] T4-O-1 FastAPI app + `/healthz`
- [ ] T4-O-2 All CONTRACTS endpoints; async runs; per-app `409` locks
- [ ] T4-O-3 Stub mode replaying `events.jsonl`
- [ ] T4-O-4 SSE with `Last-Event-ID` replay + keep-alive
- [ ] T4-O-5 Lifecycle transitions enforced
- [ ] T4-O-6 `/runs/wave/{n}` (real apply + cutover, synthetic dry-run + sim)
- [ ] T4-O-7 `/demo/bad-wave`, `/demo/reset`
- [ ] T4-O-8 Traffic generator autostart
- [ ] T4-O-9 Heartbeat watchdog (tested with a hard kill)
- [ ] T4-O-10 API tests on stub mode
- [ ] T4-S-1 `Makefile` (`run`, `demo-reset`, `demo-check`, `e2e`, `destroy`)

### 14. Dashboard (frontend) — Track 4 / C2
- [ ] T4-F-1 Scaffold + colour tokens
- [ ] T4-F-2 Typed API client + SSE hook
- [ ] T4-F-3 Mock API from fixtures
- [ ] T4-F-4 Fleet tab
- [ ] T4-F-5 Activity tab
- [ ] T4-F-6 Plan tab (capacity slider + projection)
- [ ] T4-F-7 Blueprint diff tab
- [ ] T4-F-8 Cutover live chart + rollback banner
- [ ] T4-F-9 Dependencies graph
- [ ] T4-F-10 Impact panel
- [ ] T4-F-11 Demo controls (`?demo=1`)
- [ ] T4-F-12 Loading/error states everywhere; projector test

### 15. Gates & demo readiness (everyone)
- [ ] G0 (H+2) contract freeze met
- [ ] G1 (H+8) every agent on fixtures from the CLI; orchestrator stub mode; dashboard
      Fleet + Activity on the mock; `fleet.json` generated
- [ ] G2 (H+16) every agent on real AWS; orchestrator + dashboard on real data
- [ ] G3 (H+24) all 3 real apps migrate end-to-end from the dashboard; bad wave rolls
      back; bug list sorted
- [ ] Feature freeze (H+30)
- [ ] Demo runs 3× in a row without a code change, under 6 minutes
- [ ] Backup video recorded
- [ ] Q&A answers rehearsed (DEMO_SCRIPT.md)

---

**Bottom line:** the cloud is done and verified live. Both accounts, peering,
cross-account IAM and the ALB are working, and the legacy chain is served through
the ALB. Everything left is the agents, the orchestrator and the dashboard (§7–15),
plus a short cloud carry-over (§6). T1-1 and T1-2 must land before Track 3 can run
for real.
