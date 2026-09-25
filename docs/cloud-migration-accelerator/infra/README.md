# Infrastructure — Two AWS Accounts

**Owners:** C1 (lead) and C2.

**Goal:** both environments are built from code, can be rebuilt in under 20 minutes, and cost less than about $2/hour.

## Accounts and profiles

```ini
# ~/.aws/config
[profile mig-legacy]
region = us-east-1
# Account A — legacy

[profile mig-target]
region = us-east-1
# Account B — target, agents run here
```

Pick **one region** for everything. VPC peering, the ALB IP targets, and cross-account security-group references all assume the same region.

## Terraform layout

```
infra/terraform/
├── modules/
│   ├── network/              # VPC, 2 public + 2 private subnets, IGW, 1 NAT
│   ├── iam_cross_account/    # roles + trust policies (see below)
│   ├── legacy_app/           # INSECURE on purpose (Account A)
│   ├── golden_app/           # HARDENED blueprint (Account B) ← Blueprint agent targets this
│   └── edge_alb/             # ALB, listener, per-app rule with 2 weighted TGs
├── envs/
│   ├── legacy/               # Account A: network + 3 legacy_app + readonly role
│   └── target/               # Account B: network + peering accepter + edge_alb + app-hello + tf state
└── bootstrap/                # S3 bucket + DynamoDB lock table for state (run once, in B)
```

## Build order (and who does it)

| # | Step | Owner | Done by hour |
|---|---|---|---|
| 1 | `bootstrap/`: state bucket and lock table in B | C1 | 1 |
| 2 | `network` in both accounts (`10.10.0.0/16` in A, `10.20.0.0/16` in B) | C1 | 3 |
| 3 | VPC peering: requester in B, accepter in A, routes on both sides | C1 | 4 |
| 4 | `iam_cross_account` roles, then test with `aws sts assume-role` | C1 | 4 |
| 5 | `legacy_app` × 3 in A, with user-data running the tiny HTTP app | C2 | 6 |
| 6 | Legacy dependencies: tags, SSM params, SG references | C2 | 8 |
| 7 | `golden_app` module and reference app `app-hello` in B | C1 | 10 |
| 8 | `edge_alb`: one rule per app, `tg-legacy` (IP targets in A) and `tg-target` | C1 | 12 |
| 9 | Bad-wave variant for `app-orders` | C2 | 16 |
| 10 | `make demo-reset` and a full rebuild test | C1 | 36 |

## IAM (cross-account)

| Role | Account | Trusts | Permissions |
|---|---|---|---|
| `mig-agent-runner` | B | Your team's IAM users/SSO in B | Assume `mig-discovery-readonly`; Bedrock `InvokeModel`; ELBv2 modify (tag-conditioned); EC2 run/terminate (tag-conditioned); S3/DynamoDB for tf state |
| `mig-discovery-readonly` | A | `arn:aws:iam::<B>:role/mig-agent-runner` + ExternalId | `ec2:Describe*`, `elasticloadbalancing:Describe*`, `ssm:GetParametersByPath` on `/legacy/*`, `tag:GetResources` |

Test it:

```bash
aws sts assume-role --profile mig-target \
  --role-arn arn:aws:iam::<A>:role/mig-discovery-readonly \
  --role-session-name test --external-id <id>
```

## Legacy apps (Account A)

Each app is an EC2 t3.micro running a ~30-line Python HTTP server from user-data.

`GET /health` returns `200`. `GET /` returns:

```json
{"app": "app-orders", "served_by": "legacy", "version": "1.0", "upstream": "<result of calling PRICING_URL>"}
```

| App | Port | Depends on | Deliberate issues |
|---|---|---|---|
| `app-catalog` | 8080 | — | SSH open, unencrypted EBS, IMDSv1, old AMI, public IP |
| `app-pricing` | 8080 | app-catalog | Same, plus missing tags |
| `app-orders` | 8080 | app-pricing | Same, plus app port open to the world |

In the legacy module, set `http_tokens = "optional"` (IMDSv1), `encrypted = false`, a pinned old AMI ID, and `associate_public_ip_address = true`.

## Golden module (Account B) — the blueprint

The `golden_app` module takes these inputs, which **the Blueprint agent fills**:

| Variable | Type | Notes |
|---|---|---|
| `name` | string | app_id |
| `port` | number | App port |
| `instance_type` | string | Allowlist: `t3.micro`, `t3.small` |
| `env` | map(string) | Rewritten to target-side endpoints |
| `tags` | map(string) | Must include `owner`, `cost-center`, `data-class` |
| `listener_rule_arn` | string | From `edge_alb` output |
| `target_group_arn` | string | `tg-<app>-target` |

These are **hardcoded in the module** and never inputs:

- latest AL2023 AMI (via SSM parameter)
- private subnet, no public IP
- `http_tokens = "required"`
- KMS-encrypted gp3
- SSM instance profile, no key pair
- security group allowing ingress from the edge ALB security group only
- tag `managed-by=migration-accelerator`

## Edge ALB

- Lives in Account B, in public subnets, with one HTTP listener on :80. (Use HTTPS only if you have a cert ready; HTTP is fine for the demo.)
- **Per-app listener rule** on host header or path (`/catalog/*`, `/pricing/*`, `/orders/*`) with a `forward` action to two target groups:
  - `tg-<app>-legacy`: target type **ip**, registering the legacy private IPs in `10.10.x.x` over peering
  - `tg-<app>-target`: target type **instance**, populated by the golden module
- Initial weights are **100 / 0**. The Cutover agent changes them with `elbv2:ModifyRule`.
- Health check: `/health`, interval 5 s, healthy threshold 2, so the demo is responsive.
- Legacy security groups must allow the app port from `10.20.0.0/16`, or from the edge ALB security group if you use cross-account SG referencing.

## Bad-wave variant (C2)

- The fault lives in the **app config**, never in the module's security settings.
- When `PRICING_URL` is empty, `app-orders` returns `500` on `/`, while `/health` stays `200`. That way the ALB health check passes, and the **traffic gate** is what catches it.
- The orchestrator's `/demo/bad-wave` makes Blueprint drop `PRICING_URL` from the inputs.

## Cost guardrails

- **Expected cost:** 6× t3.micro, 1 ALB, 2 NAT gateways, and a little Bedrock usage. Roughly $1–2/hour, so about $50–100 over 48 h.
- To save money, run the NAT only in B, and let legacy use public subnets (it's "insecure" anyway).
- Set an AWS Budgets alarm in both accounts on day 0.

## Reset and teardown

```bash
make demo-reset   # weights → 100/0, destroy generated/* app instances, clear state DB
make destroy      # terraform destroy target, then legacy, then bootstrap (last)
```

Destroy **target before legacy**. The peering connection and the IP targets depend on the legacy VPC.
