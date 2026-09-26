# Environments: Old (Legacy) vs New (Target)

**Principle: the same app, moved to a better house.** The app code, port and instance size are identical in both environments. Every difference between them is a security or operations fix, and each one maps to a Discovery finding code. So every difference Discovery reports is one Blueprint fixes, and the demo's config diff shows it.

| | Old environment | New environment |
|---|---|---|
| AWS account | Account A (legacy), profile `mig-legacy` | Account B (target), profile `mig-target` |
| VPC CIDR | `10.10.0.0/16` | `10.20.0.0/16` |
| Terraform | `envs/legacy` using module `legacy_app` | `envs/target` using module `golden_app` |
| Region | Same region for both (e.g. `us-east-1`) | Same |

---

## 1. The differences

| Area | Old environment (Account A) | New environment (Account B) | Finding it proves |
|---|---|---|---|
| Network segmentation | One legacy VPC (peering to Account B needs it), but **zero private subnets** — every route table in it sends `0.0.0.0/0` to the IGW, so there's no tier for an app to hide in even if it wanted to | One target VPC with real tiering: a private-subnet route table with no IGW route for the apps, a separate public one for the ALB | `NO_VPC_SEGMENTATION` |
| Network placement (the per-instance result of that) | Public subnet, public IP on the instance | Private subnet, no public IP | `PUBLIC_IP` |
| Admin access | Port 22 open to `0.0.0.0/0`, SSH key pair | No port 22, no key pair; SSM Session Manager | `SG_OPEN_SSH` |
| App port | Open to the whole internet | Only from the edge ALB's security group | `SG_OPEN_APP` |
| Disk | Unencrypted gp2 | KMS-encrypted gp3 (`alias/mig-ebs`) | `EBS_UNENCRYPTED` |
| Instance metadata | IMDSv1 allowed | IMDSv2 required | `IMDSV1` |
| OS image | Pinned old Amazon Linux 2 AMI (past end of support) | Latest AL2023, looked up from the public SSM parameter | `OLD_AMI` |
| Tags | `owner`, `cost-center` and `data-class` missing on Pricing and Orders | Mandatory tags, plus `managed-by=migration-accelerator` | `MISSING_TAGS` |
| App config | Hardcoded private IPs, e.g. `PRICING_URL=http://10.10.1.40:8080` | Service endpoints, e.g. `http://<alb-dns>/pricing` | `HARDCODED_IP` |
| How traffic reaches the app | Direct to the instance | Only through the edge ALB | — |
| Instance role | None | `mig-app-instance` (SSM only) | — |
| Outbound internet | Directly through the IGW | Through a NAT gateway | — |
| How it's built | `legacy_app`: every insecure option set by hand | `golden_app`: hardening hardcoded, identical every time | — |

### Terraform settings behind each difference

| Setting | `legacy_app` (old) | `golden_app` (new) |
|---|---|---|
| VPC/subnet source | `legacy_app` takes `subnet_id`/SG as plain inputs, picked per call — there's no tiering module to resolve them from, and the VPC itself has no private route table to pick from anyway | always resolved from the one target VPC's tiering outputs (`target_outputs.json`) |
| `subnet_id` | a public subnet | a private subnet (pre-created, from `target_outputs.json`) |
| `associate_public_ip_address` | `true` | `false` |
| `key_name` | set | not set |
| `metadata_options.http_tokens` | `"optional"` | `"required"` |
| `root_block_device.encrypted` | `false` | `true`, with `kms_key_id = alias/mig-ebs` |
| `root_block_device.volume_type` | `gp2` | `gp3` |
| `ami` | pinned old AL2 AMI ID | `data "aws_ssm_parameter"` for the latest AL2023 |
| `iam_instance_profile` | none | `mig-app-instance` |
| Security group ingress | 22 and 8080 from `0.0.0.0/0`; 8080 from `10.20.0.0/16` (ALB over peering); 8080 from the consumer app's SG | 8080 from the edge ALB SG only |
| Tags | `app`, `depends-on`; business tags only on Catalog | `owner`, `cost-center`, `data-class`, `managed-by=migration-accelerator` |

---

## 2. What stays the same (on purpose)

These must be identical, to prove this is a **rehost**, not a rewrite:

- the same app code: a ~30-line Python HTTP server started from user-data
- port `8080`, a `/health` endpoint that returns `200`, and the same JSON response shape
- instance type `t3.micro`, and the same region
- stateless apps, with no database
- the same dependency chain: **Orders → Pricing → Catalog**

The **only code-level difference** is the `served_by` field in the response. Set it from an environment variable (`SERVED_BY=legacy` or `SERVED_BY=target`), so there is one codebase, not two.

The app must also answer on its path prefix (for example `/catalog/` and `/catalog/health`) as well as `/`, because the ALB doesn't strip prefixes.

---

## 3. What exists in only one environment

### Old environment only (Account A)

| Resource | Purpose |
|---|---|
| 3 legacy apps: `app-catalog`, `app-pricing`, `app-orders` | The real apps being migrated — same legacy VPC, but each app's subnet/SG picked independently rather than through a shared tiering module |
| IAM role `mig-discovery-readonly` | Read-only scanning by the Discovery agent |
| SSM String parameters under `/legacy/<app>/...` | App config with hardcoded IPs, one of Discovery's dependency signals |
| VPC peering accepter + route to `10.20.0.0/16` | Lets the new ALB reach the old apps |

### New environment only (Account B)

| Resource | Purpose |
|---|---|
| Edge ALB `mig-edge-alb` | Fronts **both** environments; cutover is just a weight change |
| Target groups `tg-<app>-legacy` (IP, AZ `all`) and `tg-<app>-target` (instance) | The two sides of each app; weights start at 100/0 |
| Pre-created golden resources: KMS key, `mig-golden-app` SG, `mig-app-instance` profile | Shared hardening, referenced by the golden module |
| Reference app `app-hello` | Already live on the golden module; proves the pattern works |
| NAT gateway | Outbound access for private instances |
| Terraform state: S3 bucket + DynamoDB lock table | State for everything the agents apply |
| IAM roles `mig-agent-runner`, `mig-tf-apply` | Agent runtime permissions (see `docs/TOOLS.md`) |
| Agent runtime, Bedrock (Claude), orchestrator, dashboard | The accelerator itself |
| VPC peering requester + route to `10.10.0.0/16` | Other side of the peering |

---

## 4. Legacy app details

| App | Depends on | Business tags | Extra issues |
|---|---|---|---|
| `app-catalog` | — | Present | Baseline issues only |
| `app-pricing` | `app-catalog` | **Missing** | + `MISSING_TAGS`, `HARDCODED_IP` (decision D1: its `/legacy/app-pricing/CATALOG_URL` holds `http://10.10.1.61:8080`, so the rule genuinely fires; the instance's `findings` oracle tag predates this and omits it) |
| `app-orders` | `app-pricing` | **Missing** | + `MISSING_TAGS`, `HARDCODED_IP` |

The baseline issues on all 3 apps are `SG_OPEN_SSH`, `SG_OPEN_APP`, `EBS_UNENCRYPTED`, `IMDSV1`, `OLD_AMI`, `NO_VPC_SEGMENTATION` and `PUBLIC_IP` — 7 baseline findings, plus `MISSING_TAGS` and `HARDCODED_IP` per the table above (9 distinct finding codes across the fleet).

Each dependency is expressed **three ways**, and Discovery must find all of them:

1. tag `depends-on=<provider app_id>`
2. SSM parameter containing the provider's private IP, e.g. `/legacy/app-orders/PRICING_URL`
3. the provider's security group allows port 8080 from the consumer's security group

---

## 5. Design rules

- **The old environment is insecure, not broken.** Its apps work perfectly; the problem is security. This mirrors the real client situation.
- **The headline finding is `NO_VPC_SEGMENTATION`, not `PUBLIC_IP`.** Legacy AWS always supported private subnets and security groups — claiming otherwise exaggerates the point, and that's not what's wrong with Account A. What's actually wrong, and genuinely scannable, is that Account A's VPC (it has one real VPC, needed for peering to Account B) was never given a private-subnet tier at all: every route table in it sends `0.0.0.0/0` to the IGW. `PUBLIC_IP` is the per-instance consequence — an instance can't help having a public IP if it's never offered a subnet without one. Discovery reports both codes (see `ARCHITECTURE.md` / `CONTRACTS.md`), but `NO_VPC_SEGMENTATION` is the one that tells the real story: hand-built, unsegmented infrastructure, not a missed checkbox.
- **The only failure in the demo is the bad wave**, which lives in the *new* environment's app config: `PRICING_URL` missing on `app-orders`, so `/` returns 500 while `/health` stays 200. Cutover's traffic gate catches it. Never break security settings to create it.
- **Hardening is never an LLM input.** The golden module hardcodes it. The Blueprint agent fills only `name`, `port`, `instance_type`, `env` and `tags`.
- **Agents hardcode nothing about either environment.** Discovery learns Account A by scanning it. Blueprint and Cutover read Account B from `target_outputs.json`.
- **Build order and teardown:** build legacy before target. Destroy target before legacy, because peering and the IP targets depend on the legacy VPC.

---

## 6. Account setup (two real AWS accounts)

Account A and Account B are two separate, real AWS accounts — not two VPCs in one account. Steps:

1. **Create Account A (legacy)**: sign up with a dedicated email, phone-verify, attach a payment method. This becomes `mig-legacy`.
2. **Create Account B (target)**: repeat with a second email. This becomes `mig-target`.
3. Configure both as named profiles locally (`~/.aws/config`), matching the profile names used throughout this doc (`mig-legacy`, `mig-target`), so Discovery/Blueprint/Cutover can target each by profile.
4. **Free tier note:** AWS moved off the always-free 12-month tier for new signups in July 2024. New accounts now get a **$200 credit for the first 6 months** instead — this comfortably covers the whole demo's usage, but confirm the credit is active on both accounts before relying on it.
5. **Cost discipline:** VPCs, subnets, security groups, and EC2 within free-tier instance-hours cost nothing. The target environment's **ALB, NAT Gateway, and KMS key are not free** — bring them up with Terraform right before a rehearsal/demo and tear them down after, rather than leaving them running between sessions.
