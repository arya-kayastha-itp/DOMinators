# Terraform — Account B (target)

Account A (legacy) is built with CloudFormation instead, in
[`../cloudformation/legacy/`](../cloudformation/legacy/ACCOUNT_A_SETUP.md). Full Account B
build record: [ACCOUNT_B_SETUP.md](ACCOUNT_B_SETUP.md).

## Apply order

```bash
# 1. One-time state backend (local state for this step only)
cd bootstrap
terraform init
terraform apply -var="profile=mig-target"
terraform output state_bucket   # copy this into ../envs/target/backend-config.hcl

# 2. Everything else, into Account B
cd ../envs/target
cp backend-config.hcl.example backend-config.hcl   # fill in the bucket name from above
terraform init -backend-config=backend-config.hcl
terraform plan
terraform apply
```

This creates: the target VPC (public + private tiers, NAT), the edge ALB with per-app
weighted target groups (weights start `100/0`), the pre-created golden resources (KMS
key, `mig-golden-app` SG, `mig-app-instance` profile), the `mig-agent-runner` /
`mig-tf-apply` roles, and the reference app `app-hello` running live on `golden_app`.

## Hand-off to the agents

Blueprint and Cutover read Account B's shape from `target_outputs.json` (per
`docs/CONTRACTS.md`) instead of hardcoding anything about it. Generate it after
every apply:

```bash
# from infra/terraform/envs/target → repo-root data/
terraform output -json > ../../../../data/target_outputs.json
```

## Turning on peering to Account A

Once Nancy has built the legacy VPC and shared her account ID + VPC ID with you:

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: enable_peering = true, legacy_account_id, legacy_vpc_id
terraform apply
```

She still needs to **accept** the peering connection from Account A, and add the
matching route for `10.20.0.0/16` on her side — that half isn't in this repo.

## Cross-account IAM

`mig-discovery-readonly` (Account A) isn't created by this env — Nancy creates it
using the same `modules/iam_cross_account` (`role_type = "discovery_readonly"`),
trusting the `agent_runner_role_arn` this env outputs, plus an `ExternalId` you two
agree on.
