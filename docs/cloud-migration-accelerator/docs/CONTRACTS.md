# Shared Contracts

These contracts are **frozen at hour 2.** After that, any change needs a sign-off from A2 and the affected owner, plus an update to `fixtures/`.

All objects are JSON, and Python definitions live in `agents/common/models.py` (Pydantic v2). Every object includes `app_id` (string, e.g. `app-orders` or `syn-00417`) and `source` (`real` | `synthetic`).

## AppRecord (Discovery → everyone)

```json
{
  "app_id": "app-orders",
  "source": "real",
  "name": "Orders API",
  "owner": "team-commerce",
  "business_unit": "Retail",
  "runtime": {"type": "ec2", "instance_ids": ["i-0abc"], "ami_id": "ami-0old", "ami_age_days": 912,
              "instance_type": "t3.micro", "port": 8080, "stateful": false},
  "network": {"vpc_id": "vpc-legacy", "vpc_has_private_subnet": false, "subnet_public": true, "public_ip": true, "private_ip": "10.10.1.23",
              "sg_ingress": [{"port": 22, "cidr": "0.0.0.0/0"}, {"port": 8080, "cidr": "0.0.0.0/0"}]},
  "storage": {"ebs_encrypted": false, "volume_gb": 8},
  "metadata": {"imds_v2_required": false},
  "config": {"env": {"PRICING_URL": "http://10.10.1.40:8080"}},
  "depends_on": ["app-pricing"],
  "tags": {"depends-on": "app-pricing"},
  "findings": ["SG_OPEN_SSH", "SG_OPEN_APP", "EBS_UNENCRYPTED", "IMDSV1", "OLD_AMI", "NO_VPC_SEGMENTATION", "PUBLIC_IP", "MISSING_TAGS", "HARDCODED_IP"],
  "status": "DISCOVERED"
}
```

## Tiering (Discovery)

```json
{"app_id": "app-orders", "tier": "GOLDEN", "score": 84,
 "reasons": ["stateless", "matches golden_app pattern", "all findings auto-fixable"],
 "risk_summary": "Publicly exposed with SSH open; fixes are standard and automatable.",
 "decided_by": "rules"}
```

- `tier` is one of `GOLDEN` | `GRAY` | `RED`
- `decided_by` is one of `rules` | `llm`

## WavePlan (Planning)

```json
{"plan_id": "plan-001", "generated_at": "2026-10-03T10:00:00Z",
 "capacity_per_wave": 40, "waves_per_week": 3,
 "waves": [
   {"wave": 0, "name": "Pilot", "start": "2026-10-05", "app_ids": ["app-catalog", "app-pricing", "app-orders"],
    "tier_mix": {"GOLDEN": 3}, "rationale": "Real pilot apps; providers first."},
   {"wave": 1, "start": "2026-10-07", "app_ids": ["syn-00012", "..."], "tier_mix": {"GOLDEN": 40}}
 ],
 "parked": ["syn-00991"],
 "projection": {"apps_total": 1003, "apps_schedulable": 871, "projected_finish": "2027-09-14",
                "apps_per_day": 5.7, "meets_target_2027": true}}
```

## BlueprintResult (Blueprint → Cutover)

```json
{"app_id": "app-orders", "blueprint": "golden_app@v1",
 "inputs": {"name": "app-orders", "port": 8080, "instance_type": "t3.micro",
            "env": {"PRICING_URL": "http://pricing.target.internal:8080"},
            "tags": {"owner": "team-commerce", "cost-center": "unknown", "data-class": "internal"}},
 "fixes": [{"finding": "SG_OPEN_SSH", "fix": "SSH removed; SSM Session Manager"},
           {"finding": "EBS_UNENCRYPTED", "fix": "KMS-encrypted gp3"}],
 "gaps": [{"field": "cost-center", "note": "not found in legacy; defaulted"}],
 "diff": {"before": "...legacy summary...", "after": "...generated main.tf..."},
 "tf_dir": "generated/app-orders", "validate_ok": true, "applied": true,
 "outputs": {"instance_ids": ["i-0new"], "tg_target_arn": "arn:...", "tg_legacy_arn": "arn:...",
             "listener_rule_arn": "arn:..."},
 "status": "PROVISIONED"}
```

## CutoverRun (Cutover)

```json
{"run_id": "cut-0007", "app_id": "app-orders", "steps": [10, 50, 100],
 "history": [{"weight": 10, "ts": "...", "error_rate": 0.0, "p95_ms": 120, "target_share": 0.11, "gate": "PASS"}],
 "result": "MIGRATED",
 "rollback": null,
 "explanation": "All gates passed at every step."}
```

- `result` is one of `MIGRATED` | `ROLLED_BACK` | `ABORTED`
- When `result` is `ROLLED_BACK`, `rollback` is `{"at_weight": 10, "reason": "error_rate 0.38 > 0.02"}`

## Event (everyone → dashboard)

```json
{"id": 1832, "ts": "2026-10-03T10:04:11Z", "agent": "cutover", "app_id": "app-orders",
 "type": "WEIGHT_SET", "level": "info", "payload": {"weight": 50}}
```

Event types:

- `DISCOVERY_STARTED`, `APP_DISCOVERED`, `DISCOVERY_DONE`
- `PLAN_DONE`
- `BLUEPRINT_READY`, `BLUEPRINT_DRY_RUN`, `PROVISIONED`
- `CUTOVER_STARTED`, `WEIGHT_SET`, `GATE_PASS`, `GATE_FAIL`, `ROLLED_BACK`, `MIGRATED`
- `SIM_DATA_MIGRATION`, `SIM_DECOMMISSION`, `SIM_LICENSE_FLAG`, `SIM_NOTIFY`
- `ERROR`

## Orchestrator API (A2)

| Method | Path | Purpose |
|---|---|---|
| POST | `/runs/discovery` | Start discovery |
| POST | `/runs/planning` | Build the wave plan |
| POST | `/runs/blueprint/{app_id}` | Generate the blueprint (and apply, for real apps) |
| POST | `/runs/cutover/{app_id}` | Start cutover |
| POST | `/runs/wave/{n}` | Blueprint + cutover every app in wave *n* |
| GET | `/apps`, `/apps/{id}`, `/plan`, `/blueprints/{id}`, `/cutovers/{id}` | Read state |
| GET | `/events` | SSE stream |
| POST | `/demo/bad-wave` | Toggle the bad-wave variant |
| POST | `/demo/reset` | Reset all state and weights |
