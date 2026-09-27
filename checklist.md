# Development Checklist — Cloud Migration Accelerator

What's actually built vs. still to do. **"Done" means it exists in this repo, or,
for AWS resources, is live and was checked** — not just described in a doc.

**Keep this current:** per [AGENTS.md](AGENTS.md) rule 3, every push to a personal
branch and every PR updates this file in the same commit. Tick only what is done and
verified; add `[ ]` items for anything new you discover. Task IDs (T1-x, T2-x, …)
point to the track docs in [docs/](docs/00_DELEGATION_MAP.md).

_Last verified: 2026-09-26, against the repo, both setup records, live `curl`
checks of the edge ALB, and headless-browser tests of the console._

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
- [x] T1-1 Listener rules tagged `managed-by=migration-accelerator`; `mig-agent-runner`
      policy split: `ModifyRule`/`ModifyListener` + EC2 mutations stay tag-conditioned,
      `elasticloadbalancing:Describe*` + `ec2:Describe*` unconditioned (a tag condition
      on Describe silently denies every call). Applied 0/5/0; verified as the runner:
      `describe_rules`, `describe_target_health`, then a real `modify_rule` 10→50→100→0
      during the live cutover (2026-09-27)
- [x] T1-2 Decision: Terraform applies with the admin profile (`TF_APPLY_USE_PROFILE=1`
      in `.env`) rather than granting `mig-tf-apply` `iam:PassRole`; used for the live
      `app-catalog` apply
- [ ] T1-3 Bedrock Claude access in `ap-south-1` confirmed with one call; `LLM_MODEL_ID` in `.env`
      — 2026-09-27: one Converse call to `global.anthropic.claude-sonnet-4-6` (and
      Haiku 4.5) answered, then minutes later every Claude model returned
      *"Model use case details have not been submitted for this account"*.
      **Blocker: someone with Account B console access submits the Anthropic
      use-case form** (Bedrock → Model catalog → any Anthropic model), waits ~15 min,
      then runs `LLM_LIVE=1 pytest agents/tests/test_llm.py -k live`. `claude-sonnet-5`
      is not enabled for the account. `LLM_MODEL_ID=global.anthropic.claude-sonnet-4-6`
      is in `.env.example`. Use-case form submitted; the live smoke test then
      **passed once**, but the next calls failed with *"Model access is denied due to
      INVALID_PAYMENT_INSTRUMENT … AWS Marketplace subscription for this model cannot
      be completed"*. **Blocker: Account B (or its org's management account) needs a
      valid payment method that can buy AWS Marketplace subscriptions** (Anthropic
      models on Bedrock are billed through Marketplace). Every hook fell back to rules
      correctly during that run (3 `LLM_FALLBACK` events; tiering falls back silently)
- [x] T1-4 `app_routes` output in `envs/target` (`path_prefix`, `priority`, `port`,
      `listener_port`, `health_path`, `runtime`); `data/target_outputs.json` re-exported
      **without a BOM** (the previous PowerShell export had one, which breaks Python's
      `json.load`); verified with `json.load`
- [x] `JuiceShopSG`/`JuiceShopInstance`/`GiteaSG`/`GiteaInstance` + their 2
      `PrivateIp` outputs added to `account-a-v2.yaml`, `account-a-all-in-one.yaml`
      and `04-legacy-apps.yaml` (Arya, both apps in one commit)
- [x] Change set applied to `mig-legacy-all` (Arya, via console access to Nancy's
      account) — exactly 4 `Add` rows, `PeeringConnectionId` left blank,
      `UPDATE_COMPLETE` reached (2026-09-26)
- [x] Bug found + fixed: both apps' `UserData` used `amazon-linux-extras install
      -y docker`, but the live legacy AMI is AL2023, not true Amazon Linux 2 as
      the `OldAmiId` parameter's description claims (already flagged once in
      `TRACK_1_CLOUD.md`, missed again here). `amazon-linux-extras` doesn't exist
      on AL2023 — confirmed via the instance system log (`amazon-linux-extras:
      command not found`, then `docker: command not found`) — so Docker never
      installed and both apps were unreachable (port 8080 timed out). Fixed to
      `dnf install -y docker` in all 3 CloudFormation templates and
      `docs/ADDITIONAL_APPS.md`
- [x] Live `mig-legacy-all` stack updated with the corrected `UserData`
      (`Replacement: True` on `JuiceShopInstance`/`GiteaInstance`, as expected) —
      **but the replacement instances came up with no `scripts-user` invocation
      at all** (confirmed via `/var/log/cloud-init-output.log`: no `part-001`
      attempt this time, vs. the first boot which did try and failed on
      `amazon-linux-extras`). Root cause not yet found — worth re-checking before
      any future full rebuild (T1-9). Worked around by connecting via **EC2
      Instance Connect** (no `.pem` needed, AL2023 ships it pre-installed) and
      running the `dnf install -y docker` + `docker run` commands by hand on both
      instances. Both verified: `app-juice-shop` → `curl :8080/` → `200` (local
      and external), `app-gitea` → `curl :8080/api/healthz` → `{"status":"pass"}`
      (local and external) (2026-09-26)
- [x] `VaultwardenSG`/`VaultwardenInstance` + `VaultwardenPrivateIp` output added
      to all 3 CloudFormation templates (Arya) — 3rd real app, follows Gitea's
      exact pattern: stateful (embedded SQLite on `/opt/vaultwarden`), tagged
      `stateful=true`, no `TargetVpcCidr` ingress (Red tier, parked, never
      migrates, no Account B work needed)
- [x] Change set applied to `mig-legacy-all` for `VaultwardenSG`/`VaultwardenInstance`
      — exactly 2 `Add` rows, `PeeringConnectionId` left blank, `UPDATE_COMPLETE`
      reached. This time `UserData` **did** execute on its own (Docker and the
      container were already up before any manual command ran) — the earlier
      no-`scripts-user`-invocation issue on Juice Shop/Gitea's replacement launch
      looks like it was a one-off, not systemic. Verified: `curl :8080/alive` →
      `200` (local and external) (2026-09-26)
- [ ] Legacy Juice Shop IP registered in `tg-app-juice-shop-legacy`
      (`AvailabilityZone=all`); `curl <alb>:3000/` → 200 via peering
- [x] Track 2: new apps handled — live Discovery gives Juice Shop GOLDEN (100),
      Gitea + Vaultwarden RED (30, `STATEFUL`); Wave 0 rule is now "every real app that
      isn't parked" → catalog → pricing → orders → juice-shop (2026-09-26). The
      fixtures/tests still use the 3 original apps (see §7)
- [x] Track 3: Blueprint passes `app_routes[app].runtime` into `golden_app` and
      handles apps with a `listener_port` (no `path_prefix`) — `mapper_rules.py`
      reads both from `target_outputs.json`, never hardcoded
- [x] `edge_alb` listener rules: `lifecycle { ignore_changes = [action] }`, so a later
      `terraform apply` can't silently reset Cutover's weights and undo a migration
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
- [x] All findings confirmed present by an actual scan: the live Discovery run on the
      6 real apps produced all 10 codes (incl. `STATEFUL` on Gitea/Vaultwarden)
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
- [x] Track 3 reviews `blueprint_app-catalog.json`, `cutover_*.json`,
      `traffic_app-orders.json` — `blueprint_app-catalog.json` regenerated
      from the real agent (`mapper_rules` + `render` + `diff`) against the G0
      `AppRecord` fixture, plus new `blueprint_app-pricing.json` /
      `blueprint_app-orders.json` the same way; `cutover_*.json` /
      `traffic_app-orders.json` reviewed and left as-is — still a faithful,
      schema-valid example of a `ROLLED_BACK` run
- [x] `fixtures/aws/` re-recorded with all 6 real apps; `apps` / `tiers` / `edges` /
      `summary` / `plan` rebuilt by `scripts/build_fixtures.py` (real Discovery +
      Planning over the recording, pinned clock) — 4 GOLDEN, 2 RED, Wave 0 = catalog →
      pricing → orders → juice-shop; oracle test matches all 6 `findings` tags

### 8. Shared framework
- [x] T2-FW-1 `store.py` implemented + tests (idempotent upserts, `set_status`,
      `traffic_window`, flags, `reset`); connection setup serialized after the
      threaded test caught a real "database is locked" race
- [x] T2-FW-2 `events.py` implemented (monotonic ids, JSON payloads, `emit_batch`,
      `events_since`; 100 concurrent emits from 4 threads keep unique ids, 5/5 runs)
- [x] T2-FW-3 `aws.py` implemented; two-hop `legacy()` verified live (recorded Account A
      through `mig-agent-runner` → `mig-discovery-readonly`); self-refreshing creds;
      scan scoped by `LEGACY_VPC_IDS` because Account A also runs unrelated workloads
- [x] T2-FW-4 `pytest` green on fixtures (53 tests, ~30 s incl. the 1,000-app runs) —
      no LLM code exists yet, so `LLM_BACKEND=mock` coverage comes with T4-L-4
- [x] `requirements.txt` + `.env.example` section for the agents (T1-5's variables);
      local `.env` is gitignored
- [ ] Machine note: on the Account B owner's laptop, Python takes 26–36 s to load
      certifi's CA bundle, so boto3 connections went idle and were dropped
      (`SSL: UNEXPECTED_EOF`). Worked around with `AWS_CA_BUNDLE` → a 5-cert Amazon-roots
      PEM (verification still on). Worth checking whether endpoint security causes it.
      Also: a venv inside OneDrive makes botocore's file reads very slow — use one outside
      it (`%LOCALAPPDATA%\dominators-venv`: real Discovery 52 s → 20 s)
- [x] T4-L-1 `llm.py` (bedrock / anthropic / off / mock, 20 s timeout) — written by
      A2 to unblock the LLM hooks: `call_tool(system, user, tool)` / `complete(...)`,
      Bedrock via boto3's Converse API (no `anthropic` SDK needed; pip can't reach
      PyPI on the A2 laptop), `AWS_BEARER_TOKEN_BEDROCK` honoured, `anthropic`
      backend imports the SDK lazily. Tested offline (mock + fake Converse client);
      the live Bedrock path waits on T1-3.
      **2026-09-27: Bedrock dropped (no payment method) → `watsonx` backend added
      as primary** (IBM watsonx.ai chat API, IAM token cached, forced
      `tool_choice`, JSON-in-content accepted for Granite) **plus `gemini`**
      (`functionCallingConfig` mode ANY, `parametersJsonSchema`), which is also
      the automatic fallback for `watsonx` when `GEMINI_API_KEY` is set. Both are
      stdlib HTTPS (no new dependencies).
      **Live (2026-09-27): watsonx unusable** — the project isn't linked to a WML
      instance, and via the space `token_quota_reached` (free quota spent).
      **Gemini is the demo backend**: `gemini-3.1-flash-lite` +
      `GEMINI_THINKING_LEVEL=minimal` answers in ~1.3–1.5 s (3.8/3.7/3.6-flash took
      6–18 s or 503'd "high demand"); one 4 s wait-and-retry on 429/503 absorbs
      free-tier bursts. `.env`: `LLM_BACKEND=gemini`
- [ ] T4-L-2 `tools.py` (registry, validation, allowlist guard) (C1)
- [ ] T4-L-3 `loop.py` (`TOOL_CALL` / `LLM_FALLBACK` events) (C1)
- [x] T4-L-4 LLM plumbing tests + one live smoke test — `test_llm.py`: 23 offline
      tests (every backend's request shape, IAM-token caching, watsonx → Gemini
      fallback, Gemini busy-retry, tiering/mapper guards, all 4 hooks on `mock`) +
      the live test (`LLM_LIVE=1`, uses `.env`'s backend) **passed on Gemini**; full
      suite 119/119 with it. `conftest.py` forces `LLM_BACKEND=off` so `.env` can't
      send the normal suite to a live model

### 9. Discovery — Track 2 / A1
- [x] T2-D-1 `scanner.py` on recorded responses (`IncludeDeprecated=True`, paginated,
      VPC-scoped, per-image fallback if an AMI can't be described). Tests use a small
      fake client serving `fixtures/aws/*.json` rather than `botocore.Stubber`
- [x] T2-D-2 `normalize.py` → `AppRecord` (group by `app` tag, fall back to `Name`;
      `config.env` from `/legacy/<app>/<KEY>`; missing AMI → `ami_age_days: null` + reason)
- [x] T2-D-3 `rules.py`: 10 finding rules, each unit-tested; `NO_VPC_SEGMENTATION` uses
      the effective route table (tested against the live account's unused main RT)
- [x] T2-D-4 `deps.py`: edges from 3 signals (tag, ssm/env, sg_ref), linear-time;
      real edges `orders → pricing → catalog`, each with all 3 signals
- [x] T2-D-5 `tiering.py` rules (non-EC2 runtime → GRAY per D2; commercial → RED)
- [x] T2-D-5 borderline → LLM via `submit_tiering` — **live on Gemini: 10/10
      borderline apps decided by the LLM**, sensible GRAY/GOLDEN calls. Guards added
      after the first live run (which pushed 75-point apps to RED): the model only
      picks between the two tiers either side of the nearby threshold, is told which
      findings the pattern auto-fixes, and at most 10 borderline apps go to it per run
      (real first, 4 at a time) to stay inside the free tier's ~15 req/min. RED never
      asked; rules on any failure. Takes 6–26 s in the background of a Discovery run
- [x] T2-D-6 `synthetic.py`: `fleet.json` through the same rules → deps → tiering
      (1,000 apps < 3 s rules-only)
- [x] T2-D-7 `run(scope)` + CLI `python -m agents.discovery`; events incl.
      `APP_DISCOVERED` in batches of 50 for synthetic; statuses → `TIERED`; a partial
      scope keeps the other side's edges; re-runs are idempotent
- [x] T2-D-8 Real scan of Account A works live (6 apps, all findings, 2 edges); real
      responses for the 3 original apps are recorded in `fixtures/aws/`
- [ ] Real scan < 10 s: the scan itself is ~5 s, but end to end it's ~20 s on the Account B
      owner's laptop (CA-bundle + OneDrive overhead, see §8) — confirm on a normal machine
- [x] T2-D-9 Oracle test vs. the legacy `findings` tag (never an input) — matches for all
      3 recorded apps, with D1's extra `HARDCODED_IP` on pricing

### 10. Planning + synthetic fleet + integration — Track 2 / A2
- [x] T2-P-1…4 `planner.py`: Red parked; consumer → provider graph, SCCs + small
      clusters (≤ 5) as units; priority topological packing (a unit is eligible only
      after its providers, Golden before Gray, Gray = 2 slots, units never split);
      Wave 0 = real apps not parked; 3/week on Mon/Wed/Fri skipping 15 Dec – 5 Jan;
      projection
- [x] T2-P-5 Template rationale per wave
- [x] T2-P-5 Optional LLM rationale — `planning.run()` asks the LLM to rewrite the
      pilot wave's rationale only (one call; template + `LLM_FALLBACK` on failure;
      membership/order never from the model). Live on Gemini: a correct two-sentence
      "providers before consumers; stateful apps parked" explanation
- [x] T2-P-6 `run()` + CLI `python -m agents.planning`; `PLAN_DONE`; statuses →
      `PLANNED` / `PARKED`; errors loudly if Discovery hasn't run. Live: 1,006 apps →
      29 waves, 155 parked, finish 2026-12-02
- [x] T2-P-7 Tests: 1,000+ apps < 1 s; no consumer before its provider (whole fleet);
      Wave 0 correct; capacity respected; projection moves with capacity; freeze skipped
- [x] T2-F-1 `data/generate_fleet.py` (seed 42; teams, BUs, runtimes, stateful,
      AMI age, licences, scale-free acyclic deps)
- [x] T2-F-2 Raw config only, `findings` empty — Discovery's rules compute them
- [x] T2-F-3 Tuned to 59.6 / 25.1 / 15.3 (runtime mix → 70/20/10, commercial → 2%);
      sanity checks printed and enforced; `data/fleet.json` committed
- [x] T2-I-1 `STATUS.md` created (Working / Broken / Next)
- [x] T2-I-3 `scripts/e2e_real.sh` — **passed live** for `app-catalog` (2026-09-27):
      Discovery (6 real + 1,000) → Planning → Blueprint `terraform apply`
      (`i-0f3e1e4f37dc02f57`, healthy) → Cutover 10/50/100 on real traffic (target
      share 0.097 / 0.50 / 1.0, 0% errors, p95 ~100–120 ms) → `MIGRATED`; then
      `--restore` put `/catalog` back on 100% legacy (verified 10/10 `legacy`). Runs its
      own traffic generator (outside the orchestrator nothing produces samples);
      `--cutover-only` for retries
- [x] Test leftovers removed so the demo starts from legacy (2026-09-27): golden
      `app-catalog` instance `i-0f3e1e4f37dc02f57` + its target-group attachment
      destroyed (`terraform destroy`, 2 resources); every rule verified 100/0 legacy;
      local `data/state.db` and `generated/app-catalog` deleted. Account B now runs
      only `app-hello` plus the base infra
- [x] RED/parked apps are refused by the orchestrator's lifecycle check (T4-O-5: 409
      "parked (RED)"), which the console and demo go through. A direct CLI call to
      `blueprint.run` still wouldn't refuse — Track 3 may add a guard there too

### 11. Blueprint/IaC — Track 3 / A3
- [x] T3-B-1 `GoldenInputs` schema (no IP literals in `env`) — `schema.py`:
      instance-type allowlist, the 3 required tags, no `IPV4` match in any
      `env` value (mirrors the module's own `variable` validation blocks)
- [x] T3-B-2 Rules mapper (`UPSTREAM_URL` + `REQUIRE_UPSTREAM`, tags + gaps) —
      `mapper_rules.py`; reproduces the CONTRACTS.md `app-orders` example
      verbatim (`UPSTREAM_URL=http://<alb_dns_name>/pricing/`) straight off the
      G0 fixture, wiring only from `target_outputs.json`
- [ ] T3-B-3 LLM mapper via `loop.py` with fallback — `mapper_llm.py` has the
      tool schemas (`set_golden_inputs`, `flag_gap`, `lookup_target_endpoint`)
      and the retry-once/`LLM_FALLBACK` wiring. Now runs through `llm.call_tool`
      (single-shot, so `lookup_target_endpoint` isn't wired): the model starts from
      the rules mapping and **`port` and `env` stay pinned to the rules values**
      (A2 change — an invented `UPSTREAM_URL` passes validation but breaks a real
      apply); the LLM picks instance type, tags and gaps. Live on Gemini: both real
      apps mapped by the LLM, 0 fallbacks, after two more guards — only the 3
      required tag keys are kept (Gemini added `cost_center`/`data_class`
      duplicates that would become real AWS tags; underscores are normalised), a
      blank tag keeps the rules default, and gaps are limited to fields the model
      decides. Not yet used in a real `terraform apply`. Track 3 to review
- [x] T3-B-4 `templates/main.tf.j2` → `generated/<app>/main.tf` (wiring only from
      `target_outputs.json`) — one template for real applies and local
      dry-run validates alike (`-backend=false` skips the backend block
      regardless of whether it's in the file)
- [x] T3-B-5 Diff with ≥ 7 annotated fixes per real app — `diff.py`; 7 for
      `app-catalog`, 9 each for `app-pricing`/`app-orders` (tested)
- [x] T3-B-6 Terraform runner (init/validate/plan/apply, plugin cache) —
      `terraform.py`; streams `TOOL_CALL` events, shared `TF_PLUGIN_CACHE_DIR`.
      Code path unit-tested with a faked `terraform` module (no `terraform`
      binary on this dev machine to run it against for real — see §6)
- [x] T3-B-7 Wait for target health; `PROVISIONED` / `BLUEPRINT_FAILED` — polls
      `describe_target_health` (timeout 180s), reads `instance_ids` back off
      the health descriptions. Code path tested via mocks, not live AWS
- [x] T3-B-8 Bad-wave variant (drop `UPSTREAM_URL`, keep `REQUIRE_UPSTREAM=1`) —
      dropped before `schema.validate` (still valid HCL, broken at runtime);
      tested
- [x] T3-B-9 Fix & retry with `-replace` (or `user_data_replace_on_change`) —
      `terraform.apply_replace(... "module.app.aws_instance.this")`; code
      path tested via mocks
- [x] T3-B-10 1,000 synthetic dry runs < 30 s — **5.3s** measured (1,000
      apps: map → validate → render(no write) → diff, zero render errors).
      Needed two fixes to get under budget: Jinja's `auto_reload` was
      `stat()`-ing the template file every render (this machine's slow
      filesystem again, see §8) and per-app `store.save_blueprint` /
      `set_status` calls were 2,000 individual transactions — switched to one
      `save_blueprints()` batch (new, additive, in `store.py`) plus one
      `upsert_apps()` for the status change, same trick Discovery uses
- [x] T3-B-11 `run()` + CLI — `python -m agents.blueprint --app app-catalog
      [--apply]`; statuses `BLUEPRINTED` → `PROVISIONED` / `FAILED`
- [x] `app-catalog` applied + healthy in `tg-app-catalog-target` — done live from the
      Account B owner's machine via `scripts/e2e_real.sh` (T1-2 = admin profile), 2026-09-27
- [ ] `app-pricing` applied + healthy — same blocker
- [ ] `app-orders` applied (bad variant) + healthy on `/health` — same blocker

### 12. Cutover — Track 3 / A4
- [x] T3-C-1 Local fake ALB harness — `fake_alb.py`: two real `app/server.py`
      processes (legacy/target, incl. the bad-target variant) behind a
      weighted reverse proxy, plus `FakeElbClient` (`modify_rule` /
      `describe_rules` / `describe_target_health`) — same shape `weights.py`
      expects from boto3, so nothing else branches on fake-vs-real
- [x] T3-C-2 Traffic generator (~20 req/s/app → `traffic` table) — `traffic.py`;
      thread-based (not asyncio — start/stop needed to work from any caller's
      thread) rather than the literal asyncio sketch in `agents/README.md`,
      same ~20 req/s/250ms-batch behaviour
- [x] T3-C-3 `weights.py` against the live ALB rules — implemented against the
      real `elbv2` call shape; verified against the fake ALB (real ALB needs
      T1-1, not available here)
- [x] T3-C-4 Gate evaluator + tests — `gates.py`, pure, unit-tested per
      threshold (error rate, p95, target-share ratio, healthy targets, min
      requests, settle-window exclusion)
- [x] T3-C-5 Controller (precheck, 10/50/100, gates) — `controller.py`;
      precheck/loop/rollback all verified against the fake ALB: clean
      migration, bad-wave rollback (rolls back within one observe window),
      and precheck ABORT with weights untouched
- [x] T3-C-6 Rollback < 2 s in `finally` + signal handlers — one `modify_rule`
      call, idempotent; verified a mid-loop exception still resets weights to
      100/0 via the `finally`-guarded contextmanager (SIGINT/SIGTERM handlers
      registered when on the main thread; `atexit` as a second net). A literal
      OS-level kill (`kill -9` / `taskkill /F`) was **not** exercised in this
      session — that and the hard-kill/watchdog path still want a real run
- [x] T3-C-7 Heartbeat for the orchestrator watchdog — writes
      `cutover_heartbeat:<app_id>` every 1s while cutting over; the watchdog
      that resets stale weights is Track 4's orchestrator (T4-O-9), not built here
- [x] T3-C-8 LLM explainer (template fallback) — `explainer.py`; template path
      implemented and tested (matches the fixture's tone: *"All gates passed
      at 10%, 50%, 100%; traffic followed the weights."*); LLM path live on Gemini:
      *"The app-orders cutover was rolled back after the new version triggered a 38%
      error rate, exceeding the 2% threshold."*
- [x] T3-C-9 Synthetic wave simulation (~3% seeded rollbacks) — `simulate.py`;
      deterministic per `app_id` (seeded PRNG), 1,000-app wave in **1.4s**
      after batching events (`emit_batch_leveled`, new additive function —
      preserves per-event severity and cross-app chronological order that a
      naive single-level `emit_batch` would have lost) and cutover rows
      (`save_cutovers`, new additive function)
- [x] T3-C-10 `run()` + CLI + `config.yaml` — `python -m agents.cutover --app
      app-catalog`; statuses `CUTTING_OVER` → `MIGRATED` / `ROLLED_BACK`.
      `.gitignore`'s blanket `config.yaml` credential pattern needed a
      `!agents/cutover/config.yaml` exception (same style as the existing
      `envs/target` one) — it's gate thresholds, not secrets
- [x] Clean real cutover of `app-catalog` against the **real** ALB: MIGRATED, all gates
      passed (2026-09-27). Took ~110 s, not 60–90 s: the real ALB needs ~12 s to apply a
      new weight, so `config.yaml` was tuned to `settle_s` 15 / `observe_window_s` 35 /
      `min_target_share_ratio` 0.6 (the first live run at `settle_s` 2 rolled back with
      target share 0.03), and `cutover.run()` now reads `observe_window_s` from config
      when not passed, capping settle at half the window
- [ ] Track 3 to review the gate tuning above and decide whether to trade the 60–90 s
      target for it (e.g. shorter window at 50/100%, where noise isn't an issue)
- [ ] Bad wave on `app-orders` rolls back automatically — verified 3× against
      the fake ALB's bad-target variant (rolls back at 10% every time, weights
      restored); not yet re-run against the real ALB/Account B
- [ ] Soft kill **and** hard kill mid-cutover leave weights at 100/0 — soft-kill
      equivalent (an exception mid-loop) verified; a literal process kill on
      the demo host OS is still open, per Track 3's own note that signal
      handling differs on Windows

### 13. Orchestrator (backend) — Track 4 / C1 — built by A2 (`orchestrator/`)
- [x] T4-O-1 FastAPI app + `/healthz` (`uvicorn orchestrator.main:app --port 8000`; CORS for :3000)
- [x] T4-O-2 All CONTRACTS endpoints + the addendum's; `POST /runs/*` → `202 {run_id}` on a
      thread pool; per-app lock keys → `409` on a second run. Extra read models the console needs so
      no number is computed from mock data: `/fleet`, `/summary`, `/statuses`, `/plan/preview` (the
      real planner, unsaved), `/weights/{app}` (read from the ALB), `/traffic/{app}` (per-second
      buckets of real requests), `/copilot`
- [ ] T4-O-3 Stub mode replaying `events.jsonl` — **dropped**: the console runs on the real agents
      (fixtures still back the agent tests)
- [x] T4-O-4 SSE (`GET /events`) with `Last-Event-ID`/`?after=` replay, 15 s keep-alive, `event:
      reset` when the store was reset under the client; server-side one-line `summary` per event
- [x] T4-O-5 Lifecycle enforced with reasons: blueprint needs PLANNED+, never on PARKED (closes the
      "nothing refuses a RED app" gap for anything that goes through the orchestrator), apply only for
      real apps with a target route; cutover only real + PROVISIONED + a runtime whose responses
      say which side served them; discovery refused while any run is active (it re-tiers every app)
- [x] T4-O-6 `/runs/wave/{n}`: synthetic apps → blueprint dry run + `simulate_wave` (events carry
      `sim`); real apps → parallel applies, then cutovers one at a time providers-first
- [x] T4-O-7 `/demo/bad-wave`, `/demo/reset[?destroy=true]` (weights 100/0 on every rule, optional
      `terraform destroy` of every `generated/<app>`, `store.reset()`), `/demo/weights/{app}` break-glass
- [x] T4-O-8 Traffic generator started per cutover (5 s warm-up, 8 s tail) instead of at boot, so
      only the app being cut over gets load
- [x] T4-O-9 Heartbeat watchdog thread (1 s): a CUTTING_OVER app with no live run and a heartbeat
      older than 5 s → weights 100/0 + `ROLLED_BACK{reason: watchdog}`. Unit-tested both ways; a
      literal process hard-kill on the demo host still to do
- [x] T4-O-10 API tests: `agents/tests/test_orchestrator.py` (16, on the real agents with fakes
      for AWS)
- [x] Blueprint's terraform runner streams output line by line as TOOL_CALL events (was: all at
      once when each command ended) with ANSI stripped, 1200 s timeout for init/plan/apply, and a
      `destroy()` for reset
- [x] Live through the API (2026-09-27): discovery (1,006 apps, 6 real, 10 Gemini tier calls),
      planning (29 waves, 155 parked, finish 2026-12-02, Gemini pilot rationale), and a real
      `terraform apply` of `app-catalog` with output streamed as events → PROVISIONED, healthy
- [x] Real cutovers driven from the console UI (2026-09-27, by the user): app-catalog, app-pricing
      and app-orders → MIGRATED on the real ALB
- [x] **app-juice-shop cut over live** (2026-09-27, cut-0004 → MIGRATED; target share 0.098 /
      0.496 / 1.0, 0% errors). Legacy and target run the identical Juice Shop image, so the
      golden_app `juice-shop` runtime now puts nginx in front adding `X-Served-By: target`; the
      traffic generator reads the header, and for header-marked runtimes an unmarked *success*
      counts as legacy (the rule has only the two target groups; unmarked errors stay unknown).
      Re-apply (`-replace`) is now allowed on a PROVISIONED app when the pattern changes; the
      blueprint health wait is 420 s (Juice Shop + nginx took ~3.5 min to go healthy and timed
      out at 180 s). **Track 3: the golden_app module and traffic.py changed — please review**
- [ ] Bad-wave rollback of app-orders driven from the UI (not yet done)
- [ ] `test_clean_cutover_migrates_and_follows_weights` is timing-flaky when the whole suite runs
      on the slow A2 laptop (passes alone); pre-existing
- [ ] Golden instances for catalog / pricing / orders / juice-shop are running in Account B and
      all four carry 100% of their traffic — Reset + destroy from the console after the demo
- [x] **Deployed control plane** (2026-09-27) — `infra/terraform/modules/control_plane`, wired in
      `envs/target` (17 added, 1 in-place change, 0 destroyed): a t3.small in a private subnet
      (nginx serving the static console + the orchestrator at `/api`, systemd, terraform installed
      and checksum-verified), reached only through CloudFront (HTTPS, caching off) → the edge ALB
      on port 8088, whose listener forwards only requests carrying a secret origin header.
      Instance role can only assume mig-agent-runner / mig-tf-apply, read its SSM secrets and the
      release bucket (+ Session Manager); no SSH. `.env` lives in SSM as a SecureString.
      `scripts/deploy_control_plane.py` builds, bundles, uploads and restarts via SSM
- [x] Public console is **read-only for visitors**; every action endpoint needs the operator key
      (`X-Operator-Key`, SSM `/mig/control-plane/operator_key`), enforced server-side; Copilot open
      but rate limited (4/min per viewer, 10/min overall). Tests in `test_orchestrator.py`
- [x] T1-2 closed: `mig-tf-apply` got `iam:PassRole` on `mig-app-instance`, so the deployed box
      runs golden_app terraform through the role instead of an admin profile
- [x] **Full demo flow verified on the live deployment** (2026-09-27, through the public API as
      the buttons call it): reset + destroy (52 s, laptop-created instances destroyed via
      re-rendered configs) → discovery + planning (16 s) → apply app-catalog (52 s) → fix & retry
      `-replace` (5.4 min) → cutover app-catalog MIGRATED (share 0.11 / 0.52 / 1.0, 0% errors) →
      bad wave app-orders rolled back automatically at 10% (error_rate 0.10 > 0.02, ALB 100/0) →
      final reset + destroy (clean). Two bugs found and fixed on the way: blueprints couldn't
      resolve `../../infra` through the `generated/` symlink (data/ now links infra/ and app/ to
      the current release), and the box role lacked read-only `tag:GetResources` for the
      managed-tag check — the watchdog rolled that failed cutover back within 5 s, as designed
- [ ] Teardown after the event: `terraform destroy -target=module.control_plane` (and drop
      `extra_ingress_ports`), plus Reset + destroy for the golden apps
- [ ] T4-S-1 `Makefile` — Windows demo host, so `scripts/dev.ps1` starts orchestrator + console
      instead; demo-check/e2e targets not written

### 14. Dashboard (frontend) — Track 4 / C2 — `migration-accelerator-console/`
Built as a Next.js 16 console on a contract-shaped mock layer. Verified 2026-09-26 in headless
Edge: every route renders with no console errors, no horizontal overflow at 320/768/1024/1440 px,
both themes, keyboard skip link, and the demo flows below.
- [x] T4-F-1 Scaffold + design tokens (light/dark, fixed tier/env colours), collapsible sidebar,
      breadcrumbs, command palette (Ctrl K), Copilot panel (Ctrl J), toasts
- [x] T4-F-2 Typed API client (`lib/api.ts`) + live provider: REST snapshots + the SSE stream,
      targeted refetch per event type, reconnect/resume, full reload on `reset`
- [x] T4-F-3 Mock layer **removed** (`lib/data/*`, `lib/copilot.ts` deleted) — the console runs
      only on the orchestrator; every view has loading / not-discovered / offline states
- [x] T4-F-4 Fleet tab on the live fleet (real counts, no fake sparklines or load delay; discovery
      progress from real APP_DISCOVERED events)
- [x] T4-F-5 Activity tab on the live stream (orchestrator agent, success level, hide-terraform toggle)
- [x] T4-F-6 Plan tab: slider previews through the real planner (`/plan/preview`), Commit runs
      planning, per-wave Run button + live migrated/rolled-back progress
- [x] T4-F-7 Blueprint tab: the stored BlueprintResult (real diff/fixes/gaps/inputs), stages
      derived from streamed terraform events, live terraform terminal, parked apps refused with reason
- [x] T4-F-8 Cutover tab: canvas where every particle is one real request drawn to the side that
      served it; ALB weights read live from the ALB; gates computed from real traffic with
      config.yaml thresholds; step/countdown from WEIGHT_SET/GATE_* events; rollback banner with
      the real explanation and ALB-confirmed 100/0; fix & retry; break-glass on the real ALB
- [x] T4-F-9 Dependencies graph on live edges (all signal types; migrated apps recolour)
- [x] T4-F-10 Impact panel **removed** — every figure on it was invented (ROI $, engineer-days,
      "3–4 years"); the "3–4 years" hero line on Overview is gone too
- [x] Overview: live Migration board (real apps as cards moving lane to lane on real status
      events, synthetic counts per lane), guided "next step", real stat cards
- [x] Copilot answers via `POST /copilot` from real store facts (Gemini), facts-only fallback
- [x] T4-F-11 Demo controls (`?demo=1`) + command palette call the real runs; Reset + destroy
      asks for confirmation
- [ ] T4-F-12 Loading/error states are in; **projector-resolution test still to do** (headless
      Edge is blocked by policy on the A2 laptop, so the rewired UI has not been screenshot-tested)
- [x] Console committed to git (`.gitignore` excludes `node_modules/`, `.next/` and
      `*.tsbuildinfo`)
- [x] Console wired to the orchestrator; `tsc` clean and `next build` passes (8 routes, no /impact)
- [x] `/journey` scroll-driven landing page (GSAP + ScrollTrigger + Lenis): preloader, WebGL hero
      (desktop only), pinned pipeline with a self-drawing path and a travelling packet, FLIP deep-dive
      panel, success finale. Now real: figures from `/summary` + `/demo/state` (reference values
      when offline, labelled), "Live run" replays the last real cutover's events with true relative
      times, stages ticked only if they happened
- [ ] `/journey`: frame-rate check on real hardware (headless runs can't measure 60 fps)
- [x] `/journey` linked from the console sidebar (Program → Journey); deployed at `/journey/`
- [ ] Track 3: adopt the statistical share gate in `gates.py` (see TRACK_3 T3-C-4)

### 15. Gates & demo readiness (everyone)
- [ ] G0 (H+2) contract freeze met
- [ ] G1 (H+8) every agent on fixtures from the CLI; orchestrator stub mode; dashboard
      Fleet + Activity on the mock; `fleet.json` generated
- [ ] G2 (H+16) every agent on real AWS; orchestrator + dashboard on real data
- [ ] G3 (H+24) all 3 real apps migrate end-to-end from the dashboard; bad wave rolls
      back; bug list sorted
- [ ] Feature freeze (H+30)
- [ ] Demo runs 3× in a row without a code change, under 6 minutes
- [x] Backup video recorded: 3-minute submission video published
      (https://youtu.be/_78jgGvV31k)
- [ ] Q&A answers rehearsed (DEMO_SCRIPT.md)
- [x] Root `README.md` (was still the unedited hackathon template) rewritten as the
      real project overview, with the live console
      (https://d360udbwjgf1ht.cloudfront.net/) and demo video linked at the top;
      `docs/README.md` brought in sync (same links, `dashboard/` → `migration-accelerator-console/`
      path fixes, apps-count wording no longer says "3")

---

**Bottom line:** the cloud is done and verified live. Both accounts, peering,
cross-account IAM and the ALB are working, and the legacy chain is served through
the ALB. Discovery, Planning, Blueprint and Cutover (§7–12) are all built and
pass on fixtures / a local fake ALB — `pytest` is 94 tests green. Everything
left is real-AWS verification for Blueprint/Cutover (needs T1-1, T1-2, and a
machine with a `terraform` binary), the orchestrator, and the dashboard
(§13–15), plus a short cloud carry-over (§6).
