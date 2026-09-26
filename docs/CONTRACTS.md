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
            "env": {"UPSTREAM_URL": "http://<alb_dns_name>/pricing/", "REQUIRE_UPSTREAM": "1"},
            "tags": {"owner": "team-commerce", "cost-center": "unknown", "data-class": "internal"}},
 "fixes": [{"finding": "SG_OPEN_SSH", "fix": "SSH removed; SSM Session Manager"},
           {"finding": "EBS_UNENCRYPTED", "fix": "KMS-encrypted gp3"}],
 "gaps": [{"field": "cost-center", "note": "not found in legacy; defaulted"}],
 "diff": {"before": "...legacy summary...", "after": "...generated main.tf...",
          "annotations": [{"finding": "SG_OPEN_SSH", "before_line": 3, "after_line": null, "fix": "SSH removed; SSM Session Manager"}]},
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
- `TOOL_CALL`, `LLM_FALLBACK` (any agent; the audit trail — see `agents/README.md`)
- `BLUEPRINT_FAILED`, `CUTOVER_ABORTED`
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

---

## Addendum — agents phase, frozen at Gate 0

These fill gaps found while planning the agents phase. They are part of the
frozen contract from Gate 0 (see `docs/00_DELEGATION_MAP.md`) and follow the
same change rule as everything above.

### App env naming (matches the real app code)

The shared app (`app/server.py`) and the legacy CloudFormation apps both read
**`UPSTREAM_URL`** — not `PRICING_URL`/`CATALOG_URL`. Those two names exist
only as the legacy **SSM parameter names** (`/legacy/app-orders/PRICING_URL`,
`/legacy/app-pricing/CATALOG_URL`), which is where Discovery finds them.

- Blueprint emits `UPSTREAM_URL=http://<alb_dns_name>/<provider-prefix>/` plus
  `REQUIRE_UPSTREAM=1` for any app with a provider.
- **Bad wave** = Blueprint drops `UPSTREAM_URL` but keeps `REQUIRE_UPSTREAM=1`.
  `/` then returns 500 while `/health` stays 200 (already implemented in
  `app/server.py`).

### Edge (Discovery → Planning, dashboard)

```json
{"from": "app-orders", "to": "app-pricing", "signals": ["tag", "ssm", "sg_ref"], "source": "real"}
```

- Direction is always **consumer → provider**.
- `signals` ⊆ `tag` | `ssm` | `env` | `sg_ref` | `flow_log` | `synthetic`.

### DiscoverySummary (Discovery → orchestrator; payload of `DISCOVERY_DONE`)

```json
{"apps_total": 1003, "real": 3, "synthetic": 1000,
 "tiers": {"GOLDEN": 602, "GRAY": 250, "RED": 151},
 "findings": {"SG_OPEN_SSH": 612, "NO_VPC_SEGMENTATION": 3}, "edges": 1480,
 "llm_decisions": 47, "duration_ms": 2840}
```

### TrafficSample (traffic generator → `traffic` table → Cutover gates, dashboard)

```json
{"ts": "2026-10-03T10:04:11.250Z", "app_id": "app-orders", "status": 500,
 "latency_ms": 42, "served_by": "target", "run_id": "cut-0007"}
```

`served_by` is `legacy` | `target` | `unknown` (non-JSON body / timeout).

### Store API (`agents/common/store.py`) — every track codes against this

```python
upsert_apps(apps: list[AppRecord]) -> None         get_apps(source: str | None = None) -> list[AppRecord]
upsert_tiers(tiers: list[Tiering]) -> None          get_tiers() -> list[Tiering]
replace_edges(edges: list[Edge]) -> None            get_edges() -> list[Edge]
save_plan(plan: WavePlan) -> None                   get_plan() -> WavePlan | None
save_blueprint(b: BlueprintResult) -> None          get_blueprint(app_id) -> BlueprintResult | None
save_cutover(c: CutoverRun) -> None                 get_cutover(app_id) -> CutoverRun | None
set_status(app_id: str, status: str) -> None        # lifecycle in docs/FLOW.md §2
insert_traffic(samples: list[TrafficSample]) -> None
traffic_window(app_id: str, seconds: int) -> list[TrafficSample]
get_flag(name: str) -> str | None                   set_flag(name: str, value: str) -> None   # e.g. bad_wave
reset() -> None
```

`agents/common/events.py`: `emit(agent, app_id, type, payload=None, level="info") -> Event` and
`events_since(last_id: int) -> list[Event]`.

### Agent entry points (orchestrator calls these; agents never import the orchestrator)

```python
agents.discovery.run(scope: Literal["real", "synthetic", "all"] = "all") -> DiscoverySummary
agents.planning.run(capacity_per_wave=40, waves_per_week=3, start_date: date | None = None) -> WavePlan
agents.blueprint.run(app_id: str, apply: bool = False) -> BlueprintResult     # reads bad_wave flag from store
agents.cutover.run(app_id: str, steps=(10, 50, 100), observe_window_s=20) -> CutoverRun
```

Every entry point is idempotent, emits its own events, and works with `LLM_BACKEND=off`.

### Extra orchestrator endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/edges` | `Edge[]` |
| GET | `/tiers` | `Tiering[]` |
| GET | `/traffic/{app_id}?seconds=60` | `TrafficSample[]`, bucketed per second for the chart |
| GET | `/demo/state` | `{"bad_wave": {"app-orders": true}, "running": ["cutover:app-orders"]}` |
| GET | `/healthz` | `{"ok": true, "llm_backend": "bedrock", "store": "ok"}` |

`POST /runs/*` return `202 {"run_id": "...", "status": "STARTED"}` immediately and do the work in the
background; progress arrives over `/events`. A second run on an app that is already running returns `409`.
`GET /events` supports `Last-Event-ID` so a refreshed dashboard replays what it missed.
