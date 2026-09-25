# Cloud Migration Accelerator — Hackathon Build

An agentic pipeline that migrates applications from an old, insecure AWS environment to a new, hardened one, fast enough to make "done by end of 2027" believable.

We prove it two ways at once:

- **Real slice.** 3 small stateless apps actually move between **two real AWS accounts**, with traffic shifted live.
- **Synthetic scale.** ~1,000 generated app records run through the same agents so the dashboard shows fleet-scale planning.

```
Real slice (Account A, 3 live apps) ─┐
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
| [docs/PLAN.md](docs/PLAN.md) | Everyone. 48-hour schedule, checkpoints, owners, risks |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Everyone. Two-account design, components, tech stack |
| [docs/FLOW.md](docs/FLOW.md) | Everyone. End-to-end flow, app lifecycle, sequence diagrams |
| [docs/CONTRACTS.md](docs/CONTRACTS.md) | Agent devs. Shared JSON schemas, **frozen at hour 2** |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Presenter. 6-minute judge demo, minute by minute |
| [infra/README.md](infra/README.md) | C1, C2. Account setup, Terraform layout, teardown |
| [agents/README.md](agents/README.md) | A1–A4. Shared agent framework, Bedrock, tool-calling pattern |
| [agents/discovery/README.md](agents/discovery/README.md) | A1 |
| [agents/planning/README.md](agents/planning/README.md) | A2 |
| [agents/blueprint/README.md](agents/blueprint/README.md) | A3 |
| [agents/cutover/README.md](agents/cutover/README.md) | A4 |
| [data/README.md](data/README.md) | A2. Synthetic fleet generator |
| [dashboard/README.md](dashboard/README.md) | C2, A2. Dashboard views and API |

## Repo layout

```
cloud-migration-accelerator/
├── docs/                 # plan, architecture, flow, contracts, demo script
├── infra/terraform/
│   ├── modules/          # network, legacy_app, golden_app, edge_alb, iam_cross_account
│   └── envs/             # legacy (Account A), target (Account B)
├── agents/
│   ├── common/           # Bedrock client, tool registry, state store, event bus
│   ├── discovery/
│   ├── planning/
│   ├── blueprint/
│   └── cutover/
├── orchestrator/         # FastAPI: runs agents, serves state + SSE events
├── data/                 # synthetic fleet generator + generated fleet.json
├── dashboard/            # React UI
└── generated/            # Terraform written by the Blueprint agent (git-ignored)
```

## Quick start (once built)

```bash
# 1. Infra (C1/C2)
cd infra/terraform/envs/legacy && terraform apply     # AWS_PROFILE=mig-legacy
cd ../target && terraform apply                        # AWS_PROFILE=mig-target

# 2. Synthetic data
python data/generate_fleet.py --count 1000 --seed 42

# 3. Orchestrator + dashboard
uvicorn orchestrator.main:app --port 8000
cd dashboard && npm run dev
```

## Teardown (do not skip)

```bash
cd infra/terraform/envs/target && terraform destroy
cd ../legacy && terraform destroy
rm -rf generated/*
```
