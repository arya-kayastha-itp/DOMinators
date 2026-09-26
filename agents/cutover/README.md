# Cutover & Validation Agent

**Owner:** A4 (C1 supports on the ALB and C2 on the bad wave)

**Input:** a `BlueprintResult` with its target-group and listener-rule ARNs.

**Output:** a `CutoverRun`, and live weight changes on the edge ALB.

**Demo moments:** traffic visibly moves from legacy to target, and the **bad wave auto-rolls back.**

## Components

1. **Traffic generator** (`agents/cutover/traffic.py`)
   - Sends about 20 requests per second per app to the edge ALB.
   - Records `status`, `latency_ms`, `served_by` and a timestamp into the `traffic` table.
   - Starts before the demo and runs the whole time.
   - It's the **real-time source of truth**, because CloudWatch metrics lag by about a minute.
2. **Weight controller.** Calls `elbv2.modify_rule` with forward-action weights, for example `tg-legacy: 90, tg-target: 10`.
3. **Gate evaluator.** Reads the last *N* seconds from the `traffic` table and compares them to the thresholds.
4. **Explainer (LLM).** Runs *after* the decision. It gets the metrics and the recent events, and writes a one-sentence summary. It **never** makes the rollback decision.

## Procedure

```
precheck: tg-target all healthy?  → else ABORT (weights untouched)
for step in [10, 50, 100]:
    set weights (100-step, step); emit WEIGHT_SET
    wait observe_window (20s demo / 300s real)
    m = metrics(window)
    if gate fails: set weights (100, 0); emit GATE_FAIL, ROLLED_BACK; explain; return ROLLED_BACK
    emit GATE_PASS
emit MIGRATED; emit SIM_DECOMMISSION (scheduled teardown of legacy — simulated)
```

## Gates (`config.yaml`)

```yaml
steps: [10, 50, 100]
observe_window_s: 20
min_requests: 50
gates:
  max_error_rate: 0.02
  max_p95_ms: 800
  min_target_share_ratio: 0.8   # observed target share ≥ 80% of the weight set
  require_healthy_targets: true
```

## Rollback guarantees

- A rollback is one API call back to `100/0`, so aim for under 2 s from gate failure to weights restored.
- Rollback runs in a `finally`-style path. Any crash, timeout or Ctrl-C during a cutover resets the weights to `100/0`.
- Rollback is idempotent and safe to call repeatedly.
- After a rollback, the app goes to `ROLLED_BACK`, and the target instances are **kept** for debugging.

## Synthetic apps

For wave runs that include synthetic apps, simulate the steps with timed events and a small random failure rate (about 3%, which produces some automatic rollbacks in the fleet view). This makes wave 1 look like a real batch while only `app-orders` is actually moving.

## Dashboard contract

- A live chart of **legacy share vs. target share** per app, fed from the `traffic` table, polled or streamed every 1 s.
- Markers for each `WEIGHT_SET` event.
- On `ROLLED_BACK`, a red banner with the reason and the explanation.

## Done when

- [ ] A clean cutover of app-catalog takes about 60–90 s on stage, with the traffic share visibly following the weights
- [ ] The bad wave on app-orders rolls back automatically within one observe window
- [ ] Killing the process mid-cutover leaves the weights at 100/0
- [ ] Works with `LLM_BACKEND=off` (explanation falls back to a template)
