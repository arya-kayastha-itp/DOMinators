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
- [ ] T1-4 `app_routes` output in `envs/target`; re-export `data/target_outputs.json`
- [ ] Account B owner re-runs `terraform init` in the moved `infra/terraform/envs/target`
      (copy the gitignored `backend-config.hcl` / `terraform.tfvars`) and confirms
      `terraform plan` shows no changes
- [ ] T1-5 Every developer has CLI access to Account B + can assume `mig-agent-runner`;
      `.env.example` lists all required variables
- [ ] T1-6 Account A drift reconciled (manual SG ingress + return route) — live stack
      matches the template
- [ ] T1-7 `scripts/register_legacy_targets.sh`
- [ ] T1-8 `make demo-reset` + `make demo-check`
- [ ] T1-9 Timed teardown/rebuild < 20 min; Budgets alarm in both accounts
- [ ] T1-10 Decide whether to rotate the ExternalId committed in ACCOUNT_B_SETUP.md
- [ ] All 9 findings confirmed present by an actual scan (closes with T2-D-8)
- [ ] Bad-wave behaviour verified live on a deployed target `app-orders` (closes with T3-B-8)

### 7. G0 contract freeze — Track 2 / A2 (+ A1) — **H+2**
- [ ] T2-G0-1 `agents/common/models.py` (all CONTRACTS shapes + addendum)
- [ ] T2-G0-2 `store.py` / `events.py` signatures
- [ ] T2-G0-3 Agent entry-point stubs for all 4 agents
- [ ] T2-G0-4 `fixtures/` (apps, tiers, edges, plan, summary, blueprint, cutovers,
      traffic, `events.jsonl`)
- [ ] T2-G0-5 `aws.py` signatures
- [ ] T2-G0-6 Decisions D1 (`HARDCODED_IP` on pricing) and D2 (`MISSING_TAGS` ≠ Gray)
      recorded; `Cloud_ENVIRONMENTS.md` §4 updated if D1 accepted

### 8. Shared framework
- [ ] T2-FW-1 `store.py` implemented + tests (A2)
- [ ] T2-FW-2 `events.py` implemented (A2)
- [ ] T2-FW-3 `aws.py` implemented, two-hop `legacy()` works live (A1)
- [ ] T2-FW-4 `pytest agents/` green on fixtures with `LLM_BACKEND=mock` (A2)
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
