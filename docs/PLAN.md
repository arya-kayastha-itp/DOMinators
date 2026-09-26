# Hackathon Plan — 48 Hours, 6 People

> **Update:** Track 1 (Cloud) is complete. For the remaining work, the roles, gates and
> hand-offs in [00_DELEGATION_MAP.md](00_DELEGATION_MAP.md) and the four `TRACK_*.md` files
> replace the role table and timeline below. In short, C1/C2 now own the backend and
> frontend (Track 4), and live status is tracked in [checklist.md](../checklist.md).

## Goal

By hour 40 we have a rehearsed, end-to-end demo that shows five things:

1. Discovery scans a real legacy AWS account plus 1,000 synthetic apps, and tiers them Golden / Gray / Red.
2. Planning produces a wave schedule and an "end of 2027" projection.
3. Blueprint turns an insecure legacy app into hardened Terraform, shown as a live diff, and applies it in the target account.
4. Cutover shifts real traffic from 0 to 10 to 50 to 100%.
5. A deliberately bad wave auto-rolls back on stage.

## Definition of done

| # | Criterion | Owner |
|---|---|---|
| 1 | Both accounts are provisioned from Terraform and can be rebuilt in under 20 min | C1, C2 |
| 2 | Discovery finds all 3 real apps, their findings, and their dependencies, with nothing hardcoded | A1 |
| 3 | Planning puts 1,000+ apps into waves in under 10 s | A2 |
| 4 | Blueprint output passes `terraform validate` and applies cleanly for all 3 apps | A3 |
| 5 | Cutover moves live traffic, and the dashboard reflects it within 5 s | A4 |
| 6 | Bad-wave rollback fires automatically, with no human input | A4, C2 |
| 7 | The full demo runs 3 times in a row without a code change | Everyone |
| 8 | A backup video of a clean run is recorded | C1 |

## Roles and hand-offs

| Person | Hours 0–8 | Hours 8–20 | Hours 20–32 | Hours 32–48 |
|---|---|---|---|---|
| **C1** Cloud lead | Accounts, IAM roles, VPCs, peering | Edge ALB, golden module, Bedrock access check | Support A3/A4 on apply and ALB weights | Rebuild test, backup video, presenter |
| **C2** Cloud eng | Legacy VPC, misconfigured EC2 apps | Wire dependencies, bad-wave switch | **Dashboard UI** | Dashboard polish, demo operator |
| **A1** Discovery | Scanner against fixtures | Real cross-account scan, dependency graph, tiering | Synthetic ingest at scale, dashboard panel | Hardening, rehearsal |
| **A2** Planning + integration | Contracts, orchestrator skeleton, fleet generator | Wave planner, projection | End-to-end wiring, SSE events | Integration captain, rehearsal |
| **A3** Blueprint | Map legacy config to golden-module inputs, on fixtures | LLM mapping + diff, `terraform validate` | Real `apply` into Account B | Diff view polish, rehearsal |
| **A4** Cutover | Traffic generator, health model | ALB weight shifting, metric gates | Auto-rollback, bad wave | Timing tuning, rehearsal |

**Agents develop against fixtures until checkpoint 1.** They must never wait on infrastructure. A2 commits `fixtures/` in hour 1, containing sample inventory, tiering and wave JSON that match `CONTRACTS.md`.

## Timeline

### Pre-hackathon (if allowed; otherwise do this in hour 1)

- Confirm admin access to both AWS accounts, and create CLI profiles `mig-legacy` and `mig-target`.
- Request **Bedrock model access for Claude** in the target account and the chosen region. Approval can take time.
- Set an **AWS Budgets alert** (for example, $75) in both accounts.
- Check EC2 and ALB quotas in the region.
- Create the repo and its branches: `infra`, `agents/*`, `dashboard`.

### Hours 0–2 — Kickoff and contract freeze

- Whole team spends 30 min walking through ARCHITECTURE.md and FLOW.md.
- A2 leads the **contract freeze** for the `AppRecord`, `Tiering`, `WavePlan`, `BlueprintResult` and `CutoverRun` schemas. After this, a contract change needs agreement from A2 and the affected owner.
- Everyone creates their skeleton and pushes it.

### Hours 2–8 — Foundations

- **C1:** Terraform `network` and `iam_cross_account` modules, both VPCs (non-overlapping CIDRs), and VPC peering.
- **C2:** `legacy_app` module, and 3 apps on EC2 with deliberate misconfigurations.
- **A1–A4:** build against fixtures.
- **A2:** fleet generator v1 (1,000 records).

**Checkpoint 1 at hour 8 (15-min stand-up)**
- [ ] 3 legacy apps respond on their endpoints
- [ ] Target account can assume the read-only role into legacy
- [ ] Contracts frozen, fixtures committed
- [ ] `fleet.json` generated

### Hours 8–20 — Real agents

- A1 switches Discovery to a real cross-account scan.
- A3 generates Terraform for app 1 and validates it.
- A4 shifts ALB weights, first manually with the CLI, then from code.
- C1 finishes the edge ALB with two target groups per app.
- C2 wires app dependencies and builds the bad-wave switch.
- From hour 16, **C2 moves to the dashboard.**

**Checkpoint 2 at hour 20**
- [ ] Each agent runs standalone from the CLI against the real accounts
- [ ] One app has been migrated by hand, running the agents as separate commands
- [ ] Dashboard shows the fleet view from `fleet.json`

**Sleep rotation:** stagger two 4-hour blocks so that no more than 2 people are offline at once. A2 and C1 never sleep at the same time.

### Hours 20–32 — Integration

- A2 wires the orchestrator so the chain runs as one pipeline and the UI updates live over SSE.
- The dashboard gets the dependency graph, wave schedule, diff viewer, and live cutover panel.
- A4 finishes auto-rollback; C2 prepares the bad-wave target version.

**Checkpoint 3 at hour 32 — first full dry run**
- [ ] All 3 real apps migrate end-to-end from the dashboard
- [ ] Bad wave rolls back automatically
- [ ] Every bug is listed and sorted into "must fix" or "narrate around"

### Hours 32–40 — Hardening and polish

- Fix "must fix" bugs only.
- Add the impact projection panel, plus loading and error states.
- Tune cutover timing so the whole cutover takes about 90 s on stage.
- C1 runs a **full teardown and rebuild test.**

**Hour 40 — FEATURE FREEZE.**

### Hours 40–48 — Rehearse

- Do 3 full rehearsals on a timer; the demo must stay under 6 min.
- Record the backup video after the first clean run.
- Build a reset script, `make demo-reset`, that puts legacy back at 100% and wipes the target app instances.
- Prepare Q&A answers (see DEMO_SCRIPT.md).
- Keep at least 4 hours of pure buffer.

## Daily rhythm

- Stand-up every 4 hours, 10 min maximum: what's done, what's next, what's blocked.
- A2 keeps a single `STATUS.md` board with three columns: *Working*, *Broken*, *Next*.
- Any blocker older than 30 min goes to C1 (infra) or A2 (agents and integration).

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bedrock model access isn't approved in time | Medium | Request it before the event. Fall back to the Anthropic API behind the same client wrapper (`agents/common/llm.py`) |
| Cross-account IAM misconfiguration eats hours | Medium | C1 builds the roles first and tests them with `aws sts assume-role` before any agent work |
| Terraform apply is slow or flaky on stage | Medium | Pre-apply the infra for apps 2 and 3, and apply app 1 live. Keep the apply log as a fallback |
| DNS caching makes the traffic shift look delayed | High if using DNS | Use **ALB weighted target groups**, which switch instantly, instead of Route 53 |
| LLM output breaks Terraform | Medium | The LLM only fills **inputs to a fixed golden module**, never raw HCL. Always run `terraform validate` before apply |
| Late integration surprises | High | Contracts frozen at hour 2, fixtures from hour 1, first dry run at hour 32 |
| Cost overrun | Low | t3.micro only, one NAT per VPC, budget alarm, teardown documented |
| Wi-Fi fails during judging | Medium | Backup video, plus a phone hotspot |

## Cut list (cut in this order if you fall behind)

1. VPC flow-log dependency inference. Use tags and security-group references only.
2. The LLM-written rationale in Planning. Use a template string instead.
3. The live Terraform apply of app 1. Show the pre-applied result instead.
4. The 10% traffic step. Go straight from 0 to 50 to 100.

**Never cut:** the config diff, the live traffic shift, or the auto-rollback.
