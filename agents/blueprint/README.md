# Blueprint Matching & IaC Generation Agent

**Owner:** A3 (C1 supports on the golden module)

**Input:** one `AppRecord`, plus the `golden_app` module's variable schema.

**Output:** a `BlueprintResult`, `generated/<app>/main.tf`, and (for real apps) resources applied in Account B.

**Demo moment:** a side-by-side diff showing the insecure legacy config on the left and the generated hardened Terraform on the right, with each fix annotated.

## Core idea

**We don't generate infrastructure from scratch.** We match every app to a pattern that's already proven live in the new environment (the `golden_app` module, with `app-hello` already running on it). The agent's job is to produce the right **inputs** for that pattern and to explain what changed.

That keeps the LLM output small, checkable and safe.

## Steps

1. **Match.** Choose a blueprint. For the hackathon there's only `golden_app@v1`, but keep a `match()` function so a line like "at scale there'd be 5–10 patterns" is credible. Anything that doesn't match is marked `gaps`, and the app is pushed to Gray.
2. **Map inputs (LLM).** Give Claude the `AppRecord` plus the variable schema, and require it to call `set_golden_inputs`.
   - **Rewrite env values** that point at legacy IPs to target-side names, using the dependency map. For example, `http://10.10.1.40:8080` becomes the internal ALB path for `app-pricing`.
   - **Fill tags.** Take them from the legacy record where they exist. Otherwise call `flag_gap(field, note)` and use a safe default.
3. **Validate.** Check the inputs against the Pydantic schema:
   - `instance_type` must be on the allowlist
   - the required tags must be present
   - `port` must be an int
4. **Render.** Fill `templates/main.tf.j2` with the inputs to produce `generated/<app>/main.tf`, which contains a single `module "app"` block plus its backend config.
5. **Diff.** Build the before/after view:
   - **Before:** a readable summary of the legacy config (security-group rules, encryption, IMDS, AMI, subnet)
   - **After:** the generated HCL, plus the module's fixed hardening
   - **Annotations:** each finding code mapped to the fix that resolves it
6. **Check.** Run `terraform init` → `validate` → `plan -out`, and store the plan summary. `checkov` is an optional stretch.
7. **Apply** (real apps only, `--apply`). Run `terraform apply plan.out`, which registers the new instances in `tg-<app>-target`, and emit `PROVISIONED`.
8. **Synthetic apps.** Run steps 1–5 only (dry run), which gives fleet-level stats such as "812 blueprints generated, 0 validate failures".

## Finding → fix map

| Finding | Fix in the golden module |
|---|---|
| `SG_OPEN_SSH` | No port 22; SSM Session Manager |
| `SG_OPEN_APP` | Ingress from the edge ALB security group only |
| `EBS_UNENCRYPTED` | KMS-encrypted gp3 |
| `IMDSV1` | `http_tokens = required` |
| `OLD_AMI` | Latest AL2023 AMI from an SSM parameter |
| `NO_VPC_SEGMENTATION` | Placed in the target VPC's private-subnet tier (its route table has no IGW route) |
| `PUBLIC_IP` | Private subnet, no public IP |
| `MISSING_TAGS` | Required tags enforced; gaps flagged |
| `HARDCODED_IP` | Env rewritten to service names |

## Tools exposed to the LLM

| Tool | Purpose |
|---|---|
| `set_golden_inputs(name, port, instance_type, env{}, tags{})` | The only way it produces output |
| `flag_gap(field, note)` | Record something it couldn't determine |
| `lookup_target_endpoint(app_id)` | Returns the target-side URL of a dependency |

## Bad-wave hook

When `/demo/bad-wave` is enabled for `app-orders`, drop `PRICING_URL` from the inputs **after** validation. The result is still valid Terraform, but the app is broken at runtime. That's exactly the class of bug Cutover must catch.

## Timing

Pre-apply `app-pricing` and `app-orders` before judging. Apply `app-catalog` live, which should take under 90 s. If it's slow, show the pre-applied one.

## Done when

- [ ] All 3 real apps apply cleanly and turn healthy in `tg-target`
- [ ] The diff view clearly shows at least 7 fixes for each real app
- [ ] 1,000 synthetic dry runs finish in under 30 s with zero render errors
- [ ] With `LLM_BACKEND=off`, a rule-based mapper still produces valid inputs
