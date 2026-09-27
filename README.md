# Cloud Migration Accelerator — Hackathon Build

An agentic pipeline that migrates applications from an old, insecure AWS environment to a new, hardened one, fast enough to make "done by end of 2027" believable.

**[Live console →](https://d360udbwjgf1ht.cloudfront.net/)** · **[3-minute demo video →](https://youtu.be/_78jgGvV31k)**

We prove it two ways at once:

- **Real slice.** Real apps actually move between **two real AWS accounts**, with traffic shifted live.
- **Synthetic scale.** ~1,000 generated app records run through the same agents so the dashboard shows fleet-scale planning.

```
Real slice (Account A, real apps) ───┐
                                     ├─► Discovery ─► Planning ─► Blueprint/IaC ─► Cutover ─┬─► New environment (Account B)
Synthetic scale (~1,000 records) ────┘                                                     └─► Dashboard (real + sim)
```

## Scope

We build four agents for real: **Discovery, Planning, Blueprint/IaC, Cutover**.

Data migration, decommissioning, licensing and notifications are **out of scope**. The dashboard shows them as simulated steps only.

## Team (6)

| Who | Track | Owns |
|---|---|---|
| C1 | Cloud | Accounts, cross-account IAM, networking, edge ALB, golden Terraform module |
| C2 | Cloud | Legacy environment + apps, bad-wave setup, then dashboard UI from hour 16 |
| A1 | Agents | Discovery agent |
| A2 | Agents | Planning agent, synthetic data generator, orchestrator API (integration captain) |
| A3 | Agents | Blueprint/IaC agent + Terraform apply step |
| A4 | Agents | Cutover agent, traffic generator, auto-rollback |

## Documentation map

| Doc | Read it if you are… |
|---|---|
| [AGENTS.md](AGENTS.md) | Everyone, and every AI agent — **mandatory before any work** |
| [checklist.md](checklist.md) | Everyone. What's done vs. to do; updated with every push |
| [STATUS.md](STATUS.md) | Everyone. Current working / broken / next snapshot |
| [docs/00_DELEGATION_MAP.md](docs/00_DELEGATION_MAP.md) | Everyone. Tracks, gates, who depends on whom |
| [docs/PLAN.md](docs/PLAN.md) | Everyone. Original 48-hour schedule, risks, cut list |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Everyone. Two-account design, components, tech stack |
| [docs/FLOW.md](docs/FLOW.md) | Everyone. End-to-end flow, app lifecycle, sequence diagrams |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Agent devs. Shared JSON schemas, **frozen at G0** |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Presenter. 6-minute judge demo, minute by minute |
| [docs/VIDEO_SCRIPT_3MIN.md](docs/VIDEO_SCRIPT_3MIN.md) | Presenter. Script behind the 3-minute submission video |
| [infra/README.md](infra/README.md) | Infra. Account setup, Terraform layout, teardown |
| [infra/cloudformation/legacy/ACCOUNT_A_SETUP.md](infra/cloudformation/legacy/ACCOUNT_A_SETUP.md) | Account A (legacy) build record — CloudFormation |
| [infra/terraform/ACCOUNT_B_SETUP.md](infra/terraform/ACCOUNT_B_SETUP.md) | Account B (target) build record — Terraform |
| [agents/README.md](agents/README.md) | A1–A4. Shared agent framework, LLM backends, tool-calling pattern |
| [agents/discovery/README.md](agents/discovery/README.md) | A1 |
| [agents/planning/README.md](agents/planning/README.md) | A2 |
| [agents/blueprint/README.md](agents/blueprint/README.md) | A3 |
| [agents/cutover/README.md](agents/cutover/README.md) | A4 |
| [data/README.md](data/README.md) | A2. Synthetic fleet generator |
| [migration-accelerator-console/README.md](migration-accelerator-console/README.md) | C2. Dashboard views and API |
| [SECURITY.MD](SECURITY.MD) | Everyone. Credential-safety checklist before every commit |

## Repo layout

```
├── docs/                        # plan, architecture, flow, contracts, tracks, demo scripts
├── infra/
│   ├── cloudformation/legacy/   # Account A (legacy) — CloudFormation, live
│   └── terraform/               # Account B (target) — Terraform, live
│       ├── bootstrap/           # S3 state bucket + DynamoDB lock table
│       ├── modules/             # network, golden_app, edge_alb, iam_cross_account
│       └── envs/target/
├── app/server.py                # the one app codebase both environments run
├── agents/
│   ├── common/                  # models, store, events, aws, llm, tools, loop
│   ├── discovery/  planning/  blueprint/  cutover/
├── fixtures/                     # contract-shaped sample data (G0)
├── orchestrator/                 # FastAPI: runs agents, serves state + SSE events
├── data/                         # target_outputs.json, fleet generator + fleet.json
├── migration-accelerator-console/  # Next.js dashboard (deployed to the live console above)
├── dashboard/                    # earlier React UI
└── generated/                     # Terraform written by the Blueprint agent (git-ignored)
```

## Quick start (once built)

```bash
# 1. Infra — both accounts are already live; see the two setup records for rebuilds
#    Account A: infra/cloudformation/legacy/ACCOUNT_A_SETUP.md
#    Account B: cd infra/terraform/envs/target && terraform init -backend-config=backend-config.hcl && terraform apply

# 2. Synthetic data
python data/generate_fleet.py --count 1000 --seed 42

# 3. Orchestrator + dashboard
uvicorn orchestrator.main:app --port 8000
cd migration-accelerator-console && npm run dev
```

Windows demo host: `scripts/dev.ps1` starts both the orchestrator and the console.

## Teardown (do not skip) — target before legacy

```bash
cd infra/terraform/envs/target && terraform destroy
aws cloudformation delete-stack --profile mig-legacy --stack-name <legacy stack name>
rm -rf generated/*
```

## Security

This repo includes pre-configured security files to help prevent accidental credential commits — see [SECURITY.MD](SECURITY.MD). Before every commit: review `git diff` for secrets, confirm `.env` is not staged, and use environment variables for all credentials.
