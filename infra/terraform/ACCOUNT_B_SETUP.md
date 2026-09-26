# Account B (Target / "Cloud 2.0") — Full Setup Record

This is the A-Z record of how Account B was actually built, applied, and
verified — not the plan, the real thing, including the bugs hit and how
they were fixed. Cross-reference `Cloud_ENVIRONMENTS.md` and
`ARCHITECTURE.md` for *why* Account B is designed the way it is; this doc
is the *how*, in the order it actually happened.

Owner: Priyansh. Account A (legacy) is Nancy's, built separately via
CloudFormation — not covered here except where the two accounts connect.

---

## 1. What Account B is

The "golden," properly-segmented target environment every legacy app
migrates into. One real VPC with genuine public/private tiering (unlike
Account A, which has none — see `NO_VPC_SEGMENTATION` in
`Cloud_ENVIRONMENTS.md`), fronted by one ALB that will eventually serve
both the legacy and migrated copy of each app via weighted target groups.

| | Value |
|---|---|
| AWS Account ID | `408336117553` |
| Region | `ap-south-1` (Mumbai) |
| CLI profile | `mig-target` |
| VPC CIDR | `10.20.0.0/16` |

---

## 2. Prerequisites (console, one-time)

1. **AWS account created** (a second, real AWS account — not a VPC inside
   an existing one).
2. **IAM user for CLI access**: IAM → Users → Create user (`priyansh-cli`),
   no console access needed → attach `AdministratorAccess` (fastest for a
   single-owner hackathon account) → **Security credentials** tab →
   **Create access key** → use case "Command Line Interface (CLI)".
3. **Local tooling installed** (via `winget`, since neither existed
   locally beforehand):
   ```powershell
   winget install --id Amazon.AWSCLI -e
   winget install --id Hashicorp.Terraform -e
   ```
   Result: AWS CLI `2.37.3`, Terraform `1.16.2`.
4. **CLI profile configured** (run locally, keys never pasted into chat):
   ```bash
   aws configure --profile mig-target
   # Access Key ID / Secret Access Key: from step 2
   # Default region name: ap-south-1
   # Default output format: json
   ```
   Verified with:
   ```bash
   aws sts get-caller-identity --profile mig-target
   ```

---

## 3. What's in the repo (`infra/terraform/`)

```
infra/terraform/
├── bootstrap/                  # state backend (S3 + DynamoDB), applied once
├── modules/
│   ├── network/                 # VPC + subnets + IGW; create_private_tier toggles a private RT + NAT
│   ├── iam_cross_account/       # agent_runner (this account) / discovery_readonly (legacy account) role types
│   ├── golden_app/               # the module Blueprint's terraform apply targets
│   └── edge_alb/                 # ALB + per-app weighted target groups (100/0)
├── envs/
│   └── target/                   # wires all of the above + golden shared resources + app-hello
└── README.md                      # apply order, quick reference
```

Plus `app/server.py` (repo root) — the ~30-line
shared app both environments' user-data run (`SERVED_BY` env var is the
only code-level difference between legacy and target).

**Real bugs found and fixed while building this** (all in `git log`):
- `modules/edge_alb`'s and `envs/target`'s `health_check` blocks set
  `interval = 5` without an explicit `timeout`. AWS's implicit default
  timeout ended up ≥ the interval, and the API rejects that
  (`ValidationError: Health check interval must be greater than the
  timeout`). Fixed by adding `timeout = 4` everywhere.
- `envs/target/backend.tf`'s S3 backend block had no `profile`, so it
  couldn't find credentials for state storage separately from the
  provider block. Fixed by adding `profile = "mig-target"`.
- `.gitignore` had a generic Java `target/` rule silently swallowing the
  entire `envs/target/` directory — fixed with a narrow negation.
- `modules/network` defined the public route table's internet route as an
  *inline* `route` block, while `envs/target` adds the peering route as a
  standalone `aws_route`. Terraform can't mix the two: the inline block is
  authoritative, so the first plan after peering wanted to **delete the
  peering route** (`10.10.0.0/16 → pcx-…`), which would have cut the ALB off
  from Account A. Fixed by moving the internet route to its own
  `aws_route.public_internet` (the live route was brought under it with
  `terraform import module.network.aws_route.public_internet
  rtb-0d8f131d2047b514d_0.0.0.0/0` — state only, no AWS change).
- No `.gitattributes`, with `core.autocrlf=true` on Windows: checking out
  `app/server.py` and `user_data.sh.tpl` gave them CRLF endings. Both are
  hashed into `app-hello`'s `user_data`, so the plan wanted to change a
  running instance — and a CRLF shebang (`#!/bin/bash\r`) would break the
  script on any new golden_app instance launched from a Windows machine.
  Fixed with a `.gitattributes` pinning `*.py`, `*.sh`, `*.tpl`, `*.yaml` to
  LF. Existing Windows clones need one re-checkout of those files to pick
  it up (delete them, then `git checkout -- <files>`).

---

## 4. Bootstrap — state backend

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply -var="profile=mig-target"
```

Created:
- S3 bucket **`mig-tfstate-408336117553`** (versioned, AES256 encrypted,
  all public access blocked)
- DynamoDB table **`mig-tfstate-lock`** (pay-per-request)

`.terraform.lock.hcl` is committed (Terraform's own recommendation); state
files, `.terraform/` provider caches, and `terraform.tfvars` are gitignored.

---

## 5. `envs/target` — the real build

```bash
cd ../envs/target
cp backend-config.hcl.example backend-config.hcl   # fill in the bucket name from step 4
terraform init -backend-config=backend-config.hcl
terraform plan     # reviewed before applying
terraform apply
```

**40 resources created**, in three logical groups:

**Networking**
- VPC `vpc-06b381c1e65577891` (`10.20.0.0/16`)
- 2 public subnets (`10.20.0.0/24`, `10.20.1.0/24`) + 2 private subnets
  (`10.20.10.0/24`, `10.20.11.0/24`), across `ap-south-1a`/`1b`
- Internet Gateway, 1 NAT Gateway (`nat-0355e465789b4a528`) + EIP
- Public route table → IGW; private route table → NAT, no IGW route
  (this is what makes the target environment's segmentation real)

**Edge ALB**
- `mig-edge-alb` — DNS **`mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com`**
- 1 HTTP:80 listener, default action = fixed 404
- Per-app path-based rules (`/catalog`, `/pricing`, `/orders`, priorities
  10/20/30) + `/hello` (priority 5)
- 7 target groups total: `tg-<app>-legacy` (type `ip`, for legacy
  instances reached over peering) and `tg-<app>-target` (type `instance`,
  for Blueprint's future applies), plus `tg-app-hello`. All weighted
  rules start **100/0** (100% legacy).

**Golden shared resources + reference app**
- KMS key + alias `alias/mig-ebs`
- Security group `mig-golden-app` (`sg-0b65d5d4de9d23959`) — ingress
  8080 from the ALB's SG only
- IAM role + instance profile `mig-app-instance` (SSM-only, no SSH)
- IAM roles `mig-agent-runner` and `mig-tf-apply`
- `app-hello` instance (`i-0218dbfbd7f7cf27e`, private IP `10.20.10.254`)
  running on the golden module — the live proof the pattern works

**Hand-off artifact for the agents:**
```bash
terraform output -json > ../../../../data/target_outputs.json   # → repo-root data/
```
This is what Blueprint/Cutover are supposed to read instead of
hardcoding anything about Account B (per `docs/CONTRACTS.md`).

> **Repo move (2026-09-26):** this Terraform used to live under
> `docs/cloud-migration-accelerator/infra/terraform/`; it is now at `infra/terraform/`
> (and `app/`, `data/` moved to the repo root). Nothing in AWS changes, but an existing
> local checkout must carry **three** gitignored files across, not two:
> - `envs/target/backend-config.hcl` and `envs/target/terraform.tfvars`
> - `bootstrap/terraform.tfstate` — bootstrap keeps its state **locally** (it can't
>   store state in the bucket it creates). Leave this behind and Terraform loses track
>   of the state bucket and lock table.
>
> Then `terraform init -backend-config=backend-config.hcl` in `envs/target` (plain
> `terraform init` in `bootstrap`) and confirm `terraform plan` shows **no changes** in
> both. Done and verified on the Account B owner's machine on 2026-09-26 — the first
> plan after the move surfaced the last two bugs in §3, both now fixed. Delete the old
> folder afterwards so a stale second copy of the bootstrap state can't diverge.

---

## 6. Connecting to Account A (peering)

Peering is a Terraform variable, off by default
(`enable_peering = false`) until Account A's details are known.

```hcl
# envs/target/terraform.tfvars (gitignored — has real account/VPC IDs)
enable_peering    = true
legacy_account_id = "533266974611"
legacy_vpc_id     = "vpc-0bc12dd6664275ce7"
```

```bash
terraform plan   # showed exactly 2 resources: the peering connection + 1 return route
terraform apply
```

Created:
- `aws_vpc_peering_connection` **`pcx-0ae4efd1f16fc19be`** (requester
  side — Account B always requests, Account A always accepts, since the
  ALB needs to reach legacy instances by private IP)
- A route for `10.10.0.0/16` in the **public** route table (`rtb-0d8f131d2047b514d`,
  the one the ALB's subnets use)

Nancy accepted it from Account A and added her side's return route via
her CloudFormation stack's `PeeringConnectionId` parameter. Verified:
```bash
aws ec2 describe-vpc-peering-connections --profile mig-target --region ap-south-1 \
  --vpc-peering-connection-ids pcx-0ae4efd1f16fc19be --query "VpcPeeringConnections[0].Status"
# → { "Code": "active" }
```

---

## 7. Cross-account IAM — verified working

Two-hop assume-role (this account's `mig-agent-runner`, then Account A's
`mig-discovery-readonly`):

```bash
aws sts assume-role --profile mig-target \
  --role-arn arn:aws:iam::408336117553:role/mig-agent-runner \
  --role-session-name local-hop1
# then, using hop1's temporary credentials:
aws sts assume-role \
  --role-arn arn:aws:iam::533266974611:role/mig-discovery-readonly \
  --role-session-name test --external-id 16b55c9829e2a04ccbca0163cea41f9f
```

**Two real misconfigurations found on Nancy's side and fixed:**
- Her role's trust policy principal was her **own account's root**
  (`arn:aws:iam::533266974611:root`) instead of our
  `mig-agent-runner` role ARN — meaning it never trusted us in the
  first place.
- Her `ExternalId` didn't match what was agreed (`REDS` vs.
  `16b55c9829e2a04ccbca0163cea41f9f`) — she updated it to match.

Once both were fixed, the two-hop assume-role succeeded cleanly.

---

## 8. Registering real legacy targets (manual, one-time)

The `tg-<app>-legacy` target groups exist but start empty — nothing
auto-registers legacy instance IPs into them. Using the working
cross-account role to discover the real IPs, then registering them from
Account B (where the target groups live):

```bash
# discovered via the assumed mig-discovery-readonly session:
# app-catalog 10.10.1.61 | app-orders 10.10.1.30 | app-pricing 10.10.1.138

aws elbv2 register-targets --profile mig-target --region ap-south-1 \
  --target-group-arn <tg-app-orders-legacy arn> \
  --targets Id=10.10.1.30,Port=8080,AvailabilityZone=all
# (AvailabilityZone=all is required for IPs outside this VPC, i.e. anything
# reached over peering)
```
Repeated for all 3 apps.

**Two more real issues found and fixed on Nancy's side before targets
went healthy:**
- Her 3 apps' security groups (one per app, e.g. `sg-087bff42e934b9e4a`
  for `app-orders`) didn't allow inbound 8080 from `10.20.0.0/16` —
  added via console/CLI (`authorize-security-group-ingress`) on all
  three.
- Her VPC had **two** route tables; only one was actually associated
  with the apps' subnet, and the return route to `10.20.0.0/16` had
  been added to the *other*, unassociated one. Root cause was likely her
  CloudFormation template's `RouteToTarget` resource pointing at the
  wrong route table logical ID. Fixed by adding the route directly to
  the correct one (`rtb-0f2a958079f7fffb3`).

After both fixes, all three targets went `healthy`.

---

## 9. Final end-to-end verification

```bash
curl http://mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com/orders/
```

```json
{"app": "app-orders", "served_by": "legacy", "version": "1.0",
 "upstream": "{\"app\": \"app-pricing\", \"served_by\": \"legacy\", ...
   \"upstream\": \"{\\\"app\\\": \\\"app-catalog\\\", \\\"served_by\\\": \\\"legacy\\\", ...\"}"}
```

**HTTP 200**, the full `orders → pricing → catalog` dependency chain
resolves, all `served_by: "legacy"` — reached entirely through the ALB
and the peering connection, not by hitting legacy public IPs directly.
This is the proof the link between the two accounts is genuinely live.

---

## 10. Current resource inventory (Account B)

| Resource | ID / value |
|---|---|
| VPC | `vpc-06b381c1e65577891` |
| Public subnets | `subnet-0f80e1012f02c39b9`, `subnet-0e72cd24ac9ff5e35` |
| Private subnets | `subnet-09486f771159b9ee2`, `subnet-0e294b7c30225765f` |
| NAT Gateway | `nat-0355e465789b4a528` |
| ALB | `mig-edge-alb` — `mig-edge-alb-1536629619.ap-south-1.elb.amazonaws.com` |
| ALB security group | `sg-09d4a1955cb79e931` |
| `mig-golden-app` SG | `sg-0b65d5d4de9d23959` |
| KMS alias | `alias/mig-ebs` |
| `app-hello` instance | `i-0218dbfbd7f7cf27e` (`10.20.10.254`) |
| Peering connection | `pcx-0ae4efd1f16fc19be` (to `vpc-0bc12dd6664275ce7`, active) |
| `mig-agent-runner` role | `arn:aws:iam::408336117553:role/mig-agent-runner` |
| `mig-tf-apply` role | `arn:aws:iam::408336117553:role/mig-tf-apply` |
| State bucket | `mig-tfstate-408336117553` |
| Lock table | `mig-tfstate-lock` |

---

## 11. What's still not done

- Manual browser/curl check of `/hello` (the reference app) — not yet
  confirmed
- Bedrock model access request for Claude in `ap-south-1`
- Blueprint's real `terraform apply` into the `target` groups (currently
  only the `legacy` groups have registered targets)
- Everything in `checklist.md` §6–7 (the agents themselves, the
  dashboard) — this doc only covers infrastructure

See `checklist.md` (repo root) for the full project-wide status.
