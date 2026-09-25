# End-to-End Flow

## 1. Pipeline at a glance

```mermaid
flowchart LR
  S1[Real slice<br/>3 apps in Account A] --> D
  S2[Synthetic scale<br/>fleet.json] --> D
  D[Discovery<br/>scan + tier] --> P[Planning<br/>wave schedule]
  P --> B[Blueprint/IaC<br/>match + generate + apply]
  B --> C[Cutover<br/>shift + verify]
  C --> N[New environment<br/>Account B live]
  C --> UI[Dashboard<br/>fleet view real+sim]
  C -- gate fails --> RB[Auto-rollback]
  RB --> UI
```

**Real apps** go through all four stages. **Synthetic apps** go through Discovery and Planning, then Blueprint runs in *dry-run* mode (diff only, no apply) and Cutover is simulated.

Every record carries `source: "real" | "synthetic"`, and each agent branches on that field.

## 2. App lifecycle (state machine)

```mermaid
stateDiagram-v2
  [*] --> DISCOVERED
  DISCOVERED --> TIERED
  TIERED --> PLANNED: Golden / Gray
  TIERED --> PARKED: Red (needs engineering)
  PLANNED --> BLUEPRINTED
  BLUEPRINTED --> PROVISIONED: terraform apply OK
  BLUEPRINTED --> FAILED: validate/apply error
  PROVISIONED --> CUTTING_OVER
  CUTTING_OVER --> MIGRATED: all gates pass at 100%
  CUTTING_OVER --> ROLLED_BACK: any gate fails
  ROLLED_BACK --> BLUEPRINTED: fix + retry
  MIGRATED --> [*]
```

The orchestrator owns these transitions. An agent may only move an app forward from the state it was handed.

## 3. Discovery

```mermaid
sequenceDiagram
  participant O as Orchestrator
  participant D as Discovery agent
  participant STS as STS (Account B)
  participant A as Account A APIs
  participant L as Claude (Bedrock)
  participant S as State store

  O->>D: run(scope=real+synthetic)
  D->>STS: AssumeRole mig-discovery-readonly
  D->>A: describe_instances / security_groups / volumes / images
  D->>A: ssm get_parameters_by_path(/legacy/)
  D->>D: build AppRecord per app, findings, dependency edges
  D->>D: load fleet.json → AppRecords (source=synthetic)
  D->>D: rule-based tier score
  D->>L: ambiguous cases + findings → tier + 1-line risk summary
  L-->>D: JSON {tier, reasons[]}
  D->>S: upsert AppRecord[], Tiering[], edges
  D-->>O: event DISCOVERY_DONE {counts by tier}
```

## 4. Planning

```mermaid
sequenceDiagram
  participant O as Orchestrator
  participant P as Planning agent
  participant S as State store
  O->>P: run(capacity_per_wave, start_date)
  P->>S: read AppRecords + edges + tiers
  P->>P: drop Red → PARKED
  P->>P: dependency closure (networkx), clusters
  P->>P: topological order: providers before consumers
  P->>P: pack clusters into waves (Golden first, then Gray)
  P->>P: dates + projection to end-2027
  P->>S: WavePlan
  P-->>O: event PLAN_DONE {waves, projected_finish}
```

The 3 real apps are always placed in **Wave 0 (pilot)**, so they can be demoed immediately.

## 5. Blueprint / IaC

```mermaid
sequenceDiagram
  participant O as Orchestrator
  participant B as Blueprint agent
  participant L as Claude (Bedrock)
  participant T as Terraform
  participant AB as Account B
  O->>B: run(app_id)
  B->>B: load AppRecord + golden_app variables schema
  B->>L: tools: [set_golden_inputs, flag_gap]<br/>"map this legacy config to golden inputs"
  L-->>B: set_golden_inputs({...})
  B->>B: schema-validate inputs
  B->>B: render generated/<app>/main.tf
  B->>B: build before/after diff (findings → fixes)
  B->>T: terraform init + validate + plan
  T-->>B: plan summary
  B-->>O: event BLUEPRINT_READY {diff, plan}
  alt source = real
    B->>T: terraform apply
    T->>AB: create EC2 + register in tg-<app>-target
    B-->>O: event PROVISIONED
  else source = synthetic
    B-->>O: event BLUEPRINT_DRY_RUN
  end
```

## 6. Cutover and auto-rollback

```mermaid
sequenceDiagram
  participant O as Orchestrator
  participant C as Cutover agent
  participant ALB as Edge ALB
  participant TG as Traffic generator
  participant S as State store
  O->>C: run(app_id)
  C->>ALB: describe_target_health(tg-target)
  alt target unhealthy
    C-->>O: ABORT (no traffic moved)
  end
  loop steps [10, 50, 100]
    C->>ALB: modify_rule weights legacy=100-x, target=x
    C-->>O: event WEIGHT_SET {x}
    C->>C: observe window (20s)
    TG->>S: requests {status, latency, served_by}
    C->>S: read window metrics
    alt error_rate > 2% OR p95 > 800ms OR unhealthy
      C->>ALB: weights legacy=100, target=0
      C-->>O: event ROLLED_BACK {reason, metrics}
    end
  end
  C-->>O: event MIGRATED
```

**Gates** (configurable in `agents/cutover/config.yaml`):

| Gate | Threshold |
|---|---|
| Target health | All targets `healthy` before each step |
| Error rate | ≤ 2% of requests in the window |
| Latency | p95 ≤ 800 ms |
| Served-by check | At least 80% of the expected share is served by the target (proves traffic really moved) |

The **LLM does not trigger rollback**. Rollback is pure code, so it is deterministic and fast. Claude only writes the human-readable explanation afterwards: "Rolled back at 10%: 38% 5xx from target, likely a missing `PRICING_URL`."

## 7. The bad wave (scripted moment)

1. C2 prepares `app-orders` with a blueprint variant that **omits the `PRICING_URL` input**. The golden module still applies, but the app returns 500s.
2. Presenter clicks **Run wave 1** on the dashboard.
3. Cutover sets weights to 10%, and the traffic generator sees a spike in 5xx responses.
4. The gate fails, weights snap back to 100/0 in about 1 s, and the dashboard flashes red and then shows *Rolled back*.
5. Claude's explanation appears alongside the event.
6. Optionally, click **Fix & retry**. Blueprint re-runs with the input restored, and the cutover goes green.

Controlled by: `POST /demo/bad-wave {app_id, enabled}` (orchestrator).

## 8. Data flow between agents

| From → To | Object | Stored as |
|---|---|---|
| Discovery → Planning | `AppRecord[]`, `Tiering[]`, edges | `apps`, `tiers`, `edges` tables |
| Planning → Blueprint | `WavePlan` (ordered app_ids) | `waves` table |
| Blueprint → Cutover | `BlueprintResult` (tg ARNs, instance IDs) | `blueprints` table |
| Cutover → Dashboard | `CutoverRun` + events | `cutovers`, `events` tables |
| Everyone → Dashboard | `Event` stream | `events` table → SSE `/events` |

Schemas: [CONTRACTS.md](CONTRACTS.md).
