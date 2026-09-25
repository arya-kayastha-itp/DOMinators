# Discovery & Risk-Tiering Agent

**Owner:** A1

**Input:** the legacy account (via AssumeRole) and `data/fleet.json`.

**Output:** `AppRecord[]`, `Tiering[]`, and dependency edges in the state store.

**Demo moment:** inventory, findings and the dependency graph populate live, and each app turns Golden, Gray or Red.

## What it does

1. **Scan (real).** Assume `mig-discovery-readonly` in Account A, then call:
   - `ec2.describe_instances` (filter on tag `app`)
   - `describe_security_groups`
   - `describe_volumes`
   - `describe_images` (for AMI age)
   - `ssm.get_parameters_by_path("/legacy/")`
2. **Normalize.** Build one `AppRecord` per app (instances grouped by the `app` tag).
3. **Find issues.** Run the finding rules below.
4. **Map dependencies.** Union three signals:
   - the `depends-on` tag
   - SSM or env values containing another app's IP or hostname
   - security-group rules whose source is another app's security group
5. **Ingest synthetic data.** Load `fleet.json` and use the same `AppRecord` shape with `source=synthetic`. Skip scanning, but **still run steps 3, 4 and 6**, so the synthetic fleet goes through identical logic.
6. **Tier.** Score each app with rules first; only ambiguous cases go to Claude.

## Finding rules

| Code | Condition |
|---|---|
| `SG_OPEN_SSH` | Ingress on 22 from `0.0.0.0/0` |
| `SG_OPEN_APP` | Ingress on the app port from `0.0.0.0/0` |
| `EBS_UNENCRYPTED` | Any attached volume has `Encrypted=false` |
| `IMDSV1` | `MetadataOptions.HttpTokens != required` |
| `OLD_AMI` | AMI creation date is more than 365 days ago |
| `PUBLIC_IP` | The instance has a public IP |
| `MISSING_TAGS` | Any of `owner`, `cost-center`, `data-class` is missing |
| `HARDCODED_IP` | A config value contains an IP literal |
| `STATEFUL` | Local DB port open, a large extra EBS volume, or tag `stateful=true` |

## Tiering rules

- **Start at a score of 100** and apply deductions:
  - `STATEFUL`: −60
  - an unknown runtime: −40
  - more than 5 dependencies: −15
  - `HARDCODED_IP`: −10
  - each finding without an auto-fix: −10
- **GOLDEN:** score ≥ 75 and every finding is in the golden module's auto-fix list
- **GRAY:** score 40–74, or some fix needs a human decision (e.g. an unknown `cost-center`)
- **RED:** score < 40, or `STATEFUL`, or `license=commercial` with no BYOL flag
- **Borderline** (within ±5 of a threshold): send it to Claude with the `submit_tiering` tool, and set `decided_by=llm`.

Aim for roughly **60 / 25 / 15** across the synthetic fleet. The data generator is tuned for it (see `data/README.md`), which echoes the "60% happy path" reality.

## Tools exposed to the LLM

| Tool | Purpose |
|---|---|
| `submit_tiering(app_id, tier, reasons[], risk_summary)` | Structured tier decision |
| `get_app_record(app_id)` | Read-only fetch, if it needs more context |

## Performance

- Real scan: under 10 s for 3 apps.
- Synthetic: all 1,000 apps are rules-only in under 3 s. Send only borderline cases to the LLM (about 50), run them in parallel with `asyncio`, and cap at 8 concurrent calls.
- Emit `APP_DISCOVERED` in **batches of 50** for the synthetic set so the UI doesn't choke.

## Done when

- [ ] All 3 real apps are found with the correct findings and the edges `orders→pricing→catalog`
- [ ] 1,000 synthetic apps are tiered with the target distribution
- [ ] Runs with `LLM_BACKEND=off`
- [ ] Nothing is hardcoded: renaming an app in Terraform still works

## Stretch

VPC Flow Logs in Account A to infer dependencies from real traffic.
