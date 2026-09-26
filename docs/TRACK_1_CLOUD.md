# Track 1 — Cloud (complete)

**Members:** C1 (Priyansh — Account B), C2 (Nancy — Account A). **Status:** done.
Both move to [Track 4](TRACK_4_BACKEND_FRONTEND.md); C1 finishes the carry-over
list below as part of Track 4.

The full build records are the source of truth:
- Account A: [infra/cloudformation/legacy/ACCOUNT_A_SETUP.md](../infra/cloudformation/legacy/ACCOUNT_A_SETUP.md) (CloudFormation, `account-a-v2.yaml`)
- Account B: [ACCOUNT_B_SETUP.md](../infra/terraform/ACCOUNT_B_SETUP.md) (Terraform, `envs/target`)

---

## What's live (verified)

| Item | Value / evidence |
|---|---|
| Region (both accounts) | `ap-south-1` |
| Account A (legacy) | `533266974611`, VPC `vpc-0bc12dd6664275ce7` (`10.10.0.0/16`, no private tier), 3 apps via CloudFormation — **not** the Terraform `legacy_app` module originally planned |
| Account B (target) | `408336117553`, VPC `vpc-06b381c1e65577891` (`10.20.0.0/16`, public + private tiers, NAT) |
| Peering | `pcx-0ae4efd1f16fc19be`, `active`, routes on both sides |
| Cross-account IAM | two-hop `mig-agent-runner` → `mig-discovery-readonly` (+ ExternalId) succeeds |
| Edge ALB | `mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com`; rules `/catalog` `/pricing` `/orders` at **100/0**, legacy IP targets registered + healthy |
| Golden module | `app-hello` live on `golden_app`: `GET /hello/` → `{"served_by": "target"}` (checked 2026-09-26) |
| End-to-end | `GET /orders/` through the ALB → 200 with nested orders → pricing → catalog, all `served_by: legacy` (checked 2026-09-26) |
| Hand-off artifact | `data/target_outputs.json` (ALB DNS, listener + rule ARNs, legacy/target TG ARNs, subnets, SGs, KMS alias, roles) |
| Bad-wave app behavior | Coded in `app/server.py`: `REQUIRE_UPSTREAM=1` + no `UPSTREAM_URL` → 500 on `/`, 200 on `/health`. Verified live only once Blueprint deploys `app-orders` |

## Facts the agent tracks must know (differ from the original plan)

- Apps read **`UPSTREAM_URL`**, not `PRICING_URL`. `PRICING_URL` / `CATALOG_URL` are only SSM parameter names under `/legacy/`.
- Legacy instances are identified by their **`Name`** tag (`app-catalog`, …); there is no `app` tag.
- Legacy instances carry a human-readable `findings` tag. **Discovery must never read it** as a source — only as a test oracle.
- The legacy AMI (`ami-0b60ca38391b1a1ee`, AL2023 from 2023-02-24) is **deprecated**, so `describe_images` returns nothing for it unless called with `IncludeDeprecated=True`.
- The legacy VPC has a second (main) route table that no subnet uses and that has no IGW route. `NO_VPC_SEGMENTATION` must be evaluated on each subnet's *effective* route table, or it gives the wrong answer.
- `/legacy/app-pricing/CATALOG_URL` holds an IP too, so a literal `HARDCODED_IP` rule also fires on `app-pricing`, not just `app-orders` (see Track 2 decision D1).
- The golden module needs `path_prefix` (`/catalog`, …) or the ALB health check (`/<prefix>/health`) fails. `target_outputs.json` doesn't include path prefixes yet (T1-4).

---

## Carry-over (owner C1, inside Track 4's schedule)

Real gaps found by reading the Terraform against how the agents will use it. **T1-1 and T1-2 block Track 3's real runs — do them first (by H+6).**

| ID | Task | Why |
|---|---|---|
| **T1-1** | Tag the ALB listener rules (`tags = var.tags` on `aws_lb_listener_rule` in `modules/edge_alb`) and move `elasticloadbalancing:Describe*` into a statement **without** the `aws:ResourceTag` condition in `iam_cross_account`. Verify `modify-rule` + `describe-target-health` work as `mig-agent-runner`. | `mig-agent-runner`'s ELB permissions require `managed-by=migration-accelerator` on the resource, but the listener rules are untagged, and Describe calls don't support resource-tag conditions → Cutover would get `AccessDenied` |
| **T1-2** | Give `mig-tf-apply` `iam:PassRole` on `mig-app-instance` + `iam:GetInstanceProfile` (inline policy), then run a `golden_app` plan/apply as that role. Or decide explicitly that Blueprint applies with the `mig-target` admin profile for the hackathon, and write that down. | `PowerUserAccess` excludes IAM actions; `golden_app` attaches an instance profile, which needs `PassRole` |
| **T1-3** | Bedrock: request Claude model access in `ap-south-1` (likely through an APAC cross-region inference profile), confirm with one `InvokeModel` call, put the model ID in `.env` as `LLM_MODEL_ID`. | Every agent's LLM step; `LLM_BACKEND=off` is the fallback until then |
| **T1-4** | Add an `app_routes` output (`{app: {path_prefix, priority, port}}`) to `envs/target`, re-export `data/target_outputs.json` (from `envs/target`: `../../../../data/target_outputs.json` — the setup docs now say so). | Blueprint needs `path_prefix`; the export path in the docs was wrong (now fixed) |
| **T1-5** | Give every developer CLI access to Account B (IAM user or SSO) that can assume `mig-agent-runner`; add the needed variables to `.env.example` (`AWS_REGION`, `TARGET_PROFILE`, `LEGACY_ROLE_ARN`, `LEGACY_EXTERNAL_ID`, `AGENT_RUNNER_ROLE_ARN`, `TF_APPLY_ROLE_ARN`, `LLM_BACKEND`, `LLM_MODEL_ID`). | Four agent developers hit real AWS from G2 onward, in parallel |
| **T1-6** | Reconcile Account A drift: the SG ingress from `10.20.0.0/16` and the return route were fixed by hand on the live stack. Run CloudFormation drift detection and make the live stack match `account-a-v2.yaml` (or fix the template), and record whether the readonly role trusts `mig-agent-runner`'s ARN or Account B's root. | A rebuild must reproduce the working state |
| **T1-7** | Script the legacy target registration (`scripts/register_legacy_targets.sh`: discover legacy IPs via the readonly role, `register-targets` with `AvailabilityZone=all`). | It was manual; rebuild must be < 20 min |
| **T1-8** | `make demo-reset` (weights → 100/0 on all 3 rules, `terraform destroy` each `generated/<app>`, `store.reset()`) and `make demo-check` (ALB paths return 200, legacy TGs healthy). | Needed before every rehearsal |
| **T1-9** | Full teardown/rebuild test, timed (target < 20 min); AWS Budgets alarm in both accounts; tear down ALB/NAT/KMS between sessions. | Cost + demo safety |
| **T1-10** | ExternalId and account IDs appear in plaintext in ACCOUNT_B_SETUP.md — decide whether to rotate the ExternalId and keep the new one only in `.env`. | Hygiene; it is treated as a shared secret elsewhere |

## Non-negotiables (still apply)

- ALB **weighted target groups**, not DNS.
- The bad-wave fault lives in app config only, never in security settings — the ALB health check must keep passing so the *traffic gate* catches it.
- Destroy target before legacy (peering + IP targets depend on the legacy VPC).
