# Development Checklist — Cloud Migration Accelerator

Status snapshot of what's actually built vs. still planned. "Done" means it
exists in this repo (or, for AWS resources, is live in the account) as of
this commit — not just described in a doc.

---

## 1. Documentation alignment

- [x] `docs/Cloud_ENVIRONMENTS.md` reframed: `NO_VPC_SEGMENTATION` (Account A's
      VPC has zero private subnets) is the headline finding; `PUBLIC_IP` is
      the per-instance symptom, not the story itself
- [x] `ARCHITECTURE.md`, `CONTRACTS.md`, `TRACK_1/2/3`, and the accelerator's
      own agent READMEs (Discovery, Blueprint) updated to match — finding
      codes, counts, and fix maps are consistent everywhere
- [x] Two-real-AWS-accounts setup documented (§6 of `Cloud_ENVIRONMENTS.md`),
      including the July 2024 free-tier → $200-credit change
- [x] `infra/README.md`: `network` module documented with a
      `create_private_tier` toggle (legacy: off, target: on), NAT gateway
      count fixed (was self-contradictory: said 2, then said run NAT only in
      B), peering direction fixed (target is requester, not accepter)
- [x] Pinned legacy AMI lookup documented (CLI `describe-images`, since the
      AWS Console AMI Catalog now hides Amazon Linux 2 behind AL2023)

## 2. Terraform — Account B (target), scaffolded

`docs/cloud-migration-accelerator/infra/terraform/`

- [x] `bootstrap/` — S3 state bucket + DynamoDB lock table
- [x] `modules/network` — VPC, public/private subnet tiers, IGW, NAT,
      `create_private_tier` toggle
- [x] `modules/iam_cross_account` — `agent_runner`/`discovery_readonly` role
      types (shared module, Nancy's side can reuse it)
- [x] `modules/golden_app` — the module Blueprint's `terraform apply`
      actually targets; hardcodes AMI lookup, KMS encryption, IMDSv2, tags
- [x] `modules/edge_alb` — ALB, per-app weighted target groups (100/0)
- [x] `envs/target` — wires all of the above + pre-created golden resources
      (KMS key, `mig-golden-app` SG, `mig-app-instance` profile) +
      reference app `app-hello`
- [x] Shared app code `app/server.py` (the "one codebase" both environments'
      user-data run, `SERVED_BY` env var is the only difference)
- [ ] `modules/legacy_app` + `envs/legacy` — **Nancy's, not in this repo yet**

## 3. Account B — actually live in AWS (`ap-south-1`)

- [x] Second AWS account created, IAM user `priyansh-cli` with CLI access
- [x] AWS CLI v2 + Terraform installed and on PATH
- [x] `mig-target` profile configured, verified via `sts get-caller-identity`
- [x] `bootstrap` applied — state bucket `mig-tfstate-408336117553`, lock
      table `mig-tfstate-lock`
- [x] `envs/target` applied — 40 resources live: VPC `10.20.0.0/16` with
      real public/private tiering, NAT gateway, edge ALB
      (`mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com`), 7 target
      groups, KMS key, `mig-golden-app` SG, `mig-app-instance` profile,
      `mig-agent-runner`/`mig-tf-apply` roles, and `app-hello` running
      (`i-0218dbfbd7f7cf27e`)
- [x] `data/target_outputs.json` generated — the hand-off artifact
      Blueprint/Cutover are supposed to read instead of hardcoding Account B
- [ ] Manual smoke test of `http://<alb-dns>/hello` — **not yet confirmed**
- [ ] Bedrock model access request submitted for Claude in `ap-south-1`

## 4. Account A (legacy) — Nancy's track

- [ ] AWS account created
- [ ] `legacy_app` module + `envs/legacy` (3 apps, deliberately unsegmented
      VPC, no private subnet)
- [ ] `mig-discovery-readonly` role (trusts this account's
      `mig-agent-runner` ARN + an agreed `ExternalId`)
- [ ] Pinned legacy AMI looked up and hardcoded

## 5. Cross-account wiring

- [ ] VPC peering — requester side is scaffolded in `envs/target`
      (`enable_peering` var, currently `false`) but not turned on; needs
      Nancy's account ID + VPC ID
- [ ] Peering accepted from Account A + matching route added there
- [ ] Cross-account `AssumeRole` tested end-to-end

## 6. Agents (Track 2 / Track 3) — not started

- [ ] Discovery agent (scan, finding rules, dependency mapping, tiering)
- [ ] Planning agent + synthetic fleet generator (`data/generate_fleet.py`)
- [ ] Blueprint/IaC agent (LLM mapping, diff view, real `terraform apply`)
- [ ] Cutover agent (traffic shifting, gates, auto-rollback)
- [ ] Shared framework (`agents/common/`: llm, tools, loop, models, store,
      events, aws session helpers)

## 7. Dashboard — not started

- [ ] Fleet view, tiering view, Blueprint diff view, Cutover live view

---

**Bottom line:** the documentation is internally consistent, and Account B's
infrastructure is real, applied, and working. Everything downstream of that
(Account A, the agents themselves, the dashboard) is still ahead.
