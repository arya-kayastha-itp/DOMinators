# Migration Planning Agent

**Owner:** A2 (A2 also owns the orchestrator and the synthetic data)

**Input:** `AppRecord[]`, `Tiering[]`, edges.

**Output:** a `WavePlan` with a projection.

**Demo moment:** the wave schedule appears, with a projected finish date against the end-2027 target.

This agent is **mostly rule-based on purpose.** It's the lightest of the four, which frees A2 for integration work.

## Algorithm

1. **Exclude Red.** Mark Red apps as `PARKED` and list them separately with their reasons.
2. **Build the graph.** Create a `networkx.DiGraph` with an edge from each consumer to its provider.
3. **Break cycles.** Find strongly connected components and treat each cycle as a single "move-together" unit.
4. **Cluster.** Tightly coupled small groups (for example, a component of ≤ 5 apps) become units that move in the same wave.
5. **Order.** Topologically sort the units so **providers migrate before or with their consumers**.
   - Cross-environment calls work in the meantime thanks to VPC peering, so ordering matters less than it would without peering. Say so if asked.
6. **Pack waves.**
   - **Wave 0 = the 3 real apps (pilot).**
   - Then Golden units by order, then Gray units.
   - Respect `capacity_per_wave`, and never split a unit across waves.
   - Optionally, keep each wave within one business unit, which makes change management easier.
7. **Schedule.** Start at `start_date` and run `waves_per_week` waves each week, skipping a freeze window (for example, 15 Dec to 5 Jan).
8. **Project.**
   - `projected_finish` is the date of the last wave.
   - `apps_per_day` is the number of scheduled apps divided by working days.
   - `meets_target_2027` is `projected_finish <= 2027-12-31`.
9. **Rationale (optional LLM step).** Send a summary of the plan to Claude, which returns a 2–3 sentence rationale per wave plus one overall summary. If the call fails, use a template string.

## Parameters

| Parameter | Default | Note |
|---|---|---|
| `capacity_per_wave` | 40 | The dashboard slider changes this live |
| `waves_per_week` | 3 | |
| `start_date` | today | |
| `freeze_windows` | `[["12-15","01-05"]]` | |
| `gray_capacity_factor` | 0.5 | Gray apps count as 2 slots each, since they need human review |

## Dashboard hooks

- **Capacity slider.** Changing it calls `POST /runs/planning?capacity=N`, which recomputes in well under a second, and the projection card updates. This is a nice live interaction to show judges.
- **Timeline chart.** Apps per wave, stacked by tier.

## Done when

- [ ] 1,000 apps are planned in under 1 s, without the LLM
- [ ] No consumer is scheduled before its provider (a unit test checks this)
- [ ] Wave 0 contains exactly the real apps
- [ ] The projection is correct and responds to the capacity slider
