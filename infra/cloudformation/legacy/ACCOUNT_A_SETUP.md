# Account A (Legacy) — Complete Setup Guide

This is the full runbook for standing up Account A from scratch via the
CloudFormation console, including every prerequisite, gotcha, and fix
hit while actually doing it. Template: [account-a-v2.yaml](account-a-v2.yaml).

---

## 1. What gets created

One CloudFormation stack builds:

- A VPC (`10.10.0.0/16`) with **no private-subnet tier** — this is the
  `NO_VPC_SEGMENTATION` finding (see `docs/ARCHITECTURE.md` at the repo
  root). Both subnets route `0.0.0.0/0` to the IGW; `PUBLIC_IP` on each
  instance is a consequence of this, not an independent setting.
- `mig-discovery-readonly` — an IAM role Account B's agents assume,
  read-only (EC2/ELB/SSM describe calls only).
- 3 EC2 instances: `app-catalog`, `app-pricing`, `app-orders` —
  deliberately insecure (open SSH, open app port, unencrypted EBS,
  IMDSv1, an old/deprecated AMI, missing tags on pricing/orders),
  wired together with a 3-way dependency signal (tag, SSM parameter,
  security-group reference).
- 2 SSM parameters carrying hardcoded upstream IPs (the `HARDCODED_IP`
  finding).

Full resource list and finding-code mapping: see the template's inline
comments and [README.md](README.md).

---

## 2. Prerequisites

### 2.1 AWS CLI profile (optional, needed only for verification/troubleshooting)

```bash
aws configure --profile mig-legacy
```
Prompts: Access Key ID, Secret Access Key, region (e.g. `ap-south-1`),
output format (`table` is convenient).

Verify:
```bash
aws sts get-caller-identity --profile mig-legacy
```

**Common failure:** `The config profile (mig-legacy) could not be
found` — means this terminal session doesn't have that profile
configured yet (different shell/session than where you ran
`aws configure`). Just re-run `aws configure --profile mig-legacy` in
the current terminal.

### 2.2 IAM permissions to actually create the stack

The template creates an `AWS::IAM::Role`. Whoever runs the stack needs
`iam:CreateRole`, `iam:PutRolePolicy`, `iam:TagRole` (and
`iam:GetRole`/`iam:DeleteRole`/`iam:DeleteRolePolicy` for
updates/rollback).

**Common failure:** if you're on an SSO permission set like
`PowerUserAccess`, IAM actions are **deliberately blocked** by that
policy (by AWS design, so PowerUsers can't self-escalate). You'll see:
```
User: .../AWSReservedSSO_PowerUserAccess_.../<you> is not authorized
to perform: iam:CreateRole on resource: .../role/mig-discovery-readonly
```
**Fix:** get your SSO admin to grant a narrow additional policy scoped
to `arn:aws:iam::<account>:role/mig-discovery-readonly`, or have
someone with `AdministratorAccess` run the stack.

### 2.3 An EC2 key pair

Legacy SSH access is intentionally left open (`SG_OPEN_SSH` finding),
so the instances need a key pair attached.

**EC2 console → Key Pairs → Create key pair**
- Name it (e.g. `mig-legacy-key`)
- Type: RSA, format `.pem`
- Download and save the private key (AWS doesn't keep a copy) — you
  won't need the `.pem` file itself to create the stack, only the
  **name**, which appears in the `KeyName` parameter dropdown.

### 2.4 An old/deprecated AMI ID

This is the trickiest prerequisite. The goal: an AMI ID that's
genuinely old (`OLD_AMI` finding = creation date > 365 days ago), not
just an old *label*.

**Why the AMI Catalog console doesn't work well for this:**
- **Quick Start AMIs** and **Community AMIs** tabs only show a curated,
  recent set — searching `amzn2-ami-hvm` there returns nothing useful
  or shows unrelated recent images (Ubuntu, Bottlerocket, HiveMQ,
  Fedora, etc. with 2025/2026 dates).
- **Amazon Linux 2 (AL2) itself reached end-of-life on 2026-06-30.**
  AWS has been deregistering/purging old AL2 builds since then — even
  a direct `describe-images` query sorted oldest-first only returns
  builds from ~2 months ago, because the genuinely old ones (2022,
  2023) have been removed from default visibility.
- **AWS also auto-deprecates AMIs after a retention window**, and
  `describe-images` **hides deprecated AMIs by default** — this
  applies to AL2023 too, which is why a plain query for AL2023 AMIs
  also only returns recent builds.

**The fix — query directly with `--include-deprecated`:**

```bash
aws ec2 describe-images --profile mig-legacy \
  --owners amazon \
  --include-deprecated \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
            "Name=architecture,Values=x86_64" \
  --query 'sort_by(Images, &CreationDate)[:10].[ImageId,Name,CreationDate,DeprecationTime]' \
  --output table --region <your-region>
```

This surfaces genuinely old (2023-dated), deprecated-but-still-
registered builds. Pick any from the list — a deprecated AMI is
actually a **stronger** `OLD_AMI` signal than just an old date.

**Example used in this build:** `ami-0b60ca38391b1a1ee`
(`al2023-ami-2023.0.20230222.1-kernel-6.1-x86_64`, created
2023-02-24, deprecated 2023-03-27).

**Region matters:** AMI IDs are region-specific. Whatever region this
query used must match the region you deploy the stack in (check the
console's region dropdown, top-right).

**If the stack fails on instance creation** with a deprecated-AMI
governance error (some accounts have an "Allowed AMIs" setting that
blocks deprecated images), pick a less-deprecated one from the same
query results (e.g. one deprecated closer to today, but still >365
days old by creation date).

---

## 3. Deploy the stack

1. **CloudFormation → Stacks → Create stack → With new resources
   (standard)**
2. **Template source:** Upload a template file → browse (not "recent
   files") to `infra/cloudformation/legacy/account-a-v2.yaml`
3. **Stack name:** e.g. `mig-legacy-v2`
4. **Parameters:**

| Parameter | Value | Notes |
|---|---|---|
| `EnvName` | `mig-legacy` | default |
| `KeyName` | your key pair name | e.g. `mig-legacy-key` |
| `OldAmiId` | your AMI ID | from §2.4, must match deploy region |
| `InstanceType` | `t3.micro` | default |
| `AccountBId` | Account B's 12-digit account ID | **not your own** — see §5 |
| `ExternalId` | a random string | e.g. `openssl rand -hex 16` output |
| `TargetVpcCidr` | `10.20.0.0/16` | default |
| `PeeringConnectionId` | leave blank | filled in later, see §5 |

5. **Configure stack options:** leave all defaults → Next
6. **Review:** check **"I acknowledge that AWS CloudFormation might
   create IAM resources with custom names"** (required, since this
   template creates an IAM role) → **Submit**
7. Watch the **Events** tab until `CREATE_COMPLETE` (typically 3-5
   minutes)

### Troubleshooting a failed/rolled-back stack

- **`ROLLBACK_COMPLETE` stacks cannot be updated** — delete the stack
  first, then create a fresh one. Don't "retry."
- **If an error you already fixed keeps recurring identically** after
  a fresh create, the console may be reusing a stale file selection.
  Save the template under a new filename and browse to it explicitly
  (not via a "recent files" shortcut) to rule this out.
- **`Invalid principal in policy: "AWS":"arn:...:role/mig-agent-runner"`**
  — IAM requires a role referenced as a trust-policy `Principal` to
  already exist. If Account B isn't built yet, `mig-agent-runner`
  doesn't exist, so this fails. **Fix:** trust the account **root**
  instead (`arn:aws:iam::${AccountBId}:root`), which needs nothing to
  pre-exist. Account B's own IAM policy (granting `mig-agent-runner`
  specifically `sts:AssumeRole` on this role's ARN) is what actually
  narrows it down — this is the standard cross-account pattern for
  exactly this chicken-and-egg situation.

---

## 4. Verify

Grab outputs from the stack's **Outputs** tab: `CatalogPublicIp`,
`PricingPublicIp`, `OrdersPublicIp`, `DiscoveryRoleArn`,
`VpcHasPrivateSubnet` (should read `false`).

```bash
curl http://<CatalogPublicIp>:8080/health
curl http://<OrdersPublicIp>:8080/
```

The second call should return nested JSON: `app-orders` →
`upstream` containing `app-pricing`'s response → containing
`app-catalog`'s response (`upstream: null`) — proving the full
dependency chain resolves end-to-end across all 3 real instances.

```bash
aws ssm get-parameters-by-path --profile mig-legacy --path /legacy/ --recursive
```
Should list `/legacy/app-orders/PRICING_URL` and
`/legacy/app-pricing/CATALOG_URL` with real private IPs.

```bash
aws iam get-role --profile mig-legacy --role-name mig-discovery-readonly \
  --query 'Role.AssumeRolePolicyDocument' --output json
```
Confirms the trust policy — even though `ExternalId` is a `NoEcho`
CloudFormation parameter (permanently masked in the CFN console), the
**deployed IAM role itself is a normal, fully-queryable resource** —
this command shows the real `Principal` ARN and the real `ExternalId`
value in plaintext. Use this whenever you need to recover or confirm
either value later.

---

## 5. Linking to Account B (once it exists)

### 5.1 Get Account B's info
From Account B's stack Outputs: `PeeringConnectionId` (a `pcx-...` ID).
You'll also need Account B's 12-digit account ID for the `AccountBId`
parameter (§3) — **this must be Account B's ID, not Account A's own.**
Mixing these up produces a trust policy that trusts your own account
instead of Account B, and Account B's role will get `AccessDenied`
when it tries to assume `mig-discovery-readonly`.

### 5.2 Accept the peering connection (manual — not declarative in CFN)
```bash
aws ec2 accept-vpc-peering-connection --profile mig-legacy \
  --vpc-peering-connection-id <pcx-id-from-account-b>
```

### 5.3 Add the return route
Update the Account A stack, filling in `PeeringConnectionId` with the
`pcx-...` ID. This triggers the conditional route back to
`10.20.0.0/16`.

### 5.4 Keep AccountBId and ExternalId in sync with Account B
Both sides must agree on the exact same `ExternalId` string. If
Account B's team reports `AccessDenied` on `sts:AssumeRole`, the two
most common causes are:
- `AccountBId` was set to the wrong account (see §5.1)
- `ExternalId` doesn't match exactly between what Account B passes in
  `--external-id` and what's actually in Account A's role (check with
  the command in §4)

Fix either by updating the Account A stack's parameters and
redeploying — both are safe to change any time, since they're just a
shared secret and an account pointer, not baked into anything else.

### 5.5 Verify the link
```bash
aws ec2 describe-vpc-peering-connections --profile mig-legacy \
  --vpc-peering-connection-ids <pcx-id>
```
Status should read `active`. Then, from Account B, confirm
`sts:assume-role` with the shared `--external-id` succeeds, and that
curling the edge ALB's `/orders/*` path (once weights and target
groups are wired up) returns the legacy chain instead of a 503.

---

## 6. Definition of done

- [ ] Stack reaches `CREATE_COMPLETE`
- [ ] All 3 apps respond `200` on `/health` and return correct nested
      JSON on `/`
- [ ] All 7+ findings genuinely present: `SG_OPEN_SSH`, `SG_OPEN_APP`,
      `EBS_UNENCRYPTED`, `IMDSV1`, `OLD_AMI`, `NO_VPC_SEGMENTATION`,
      `PUBLIC_IP` (all 3), `MISSING_TAGS` (pricing + orders),
      `HARDCODED_IP` (orders)
- [ ] Dependencies discoverable 3 ways: `depends-on` tag, SSM
      parameter, security-group-to-security-group reference
- [ ] `mig-discovery-readonly` trust policy points at Account B's
      account root with the correct account ID and ExternalId
- [ ] Peering connection `active`, route present on both sides
- [ ] Account B's `mig-agent-runner` can successfully assume
      `mig-discovery-readonly`
