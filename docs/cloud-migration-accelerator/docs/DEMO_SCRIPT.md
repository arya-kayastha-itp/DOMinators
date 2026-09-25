# Demo Script — 6 Minutes

**Roles:** the presenter is C1. The operator, who clicks and has the terminal ready, is C2. A2 stands by with the backup video.

**Before judges arrive:**
- Run `make demo-reset`.
- Confirm all 3 legacy apps return `served_by: legacy`.
- Start the traffic generator.
- Open the dashboard on the *Fleet* tab.
- Open the AWS console for Account B on the EC2 page in a second tab.

| Time | Screen | Say (roughly) | Do |
|---|---|---|---|
| 0:00 | Title | "Thousands of apps on an old AWS estate with known security issues. The new environment exists. Moving by hand takes 3–4 years. The target is end of 2027." | — |
| 0:30 | Fleet view | "Here's the estate. 1,000 apps: three are real and running in a live legacy account right now, and the rest are a synthetic fleet at the same scale." | Point out the "real" badges |
| 1:00 | Fleet → Discovery | "Discovery assumes a read-only role into the legacy account." | Click **Run discovery**. Tiers and findings populate, and the graph draws |
| 1:45 | Dependency graph | "It found that Orders depends on Pricing, which depends on Catalog, from tags, config and security-group rules. 62% of the fleet is Golden." | Zoom into the 3 real apps |
| 2:15 | Wave schedule | "Planning orders by dependencies and packs waves. At this capacity, we finish in September 2027." | Click **Build plan**. Projection card appears |
| 2:45 | Blueprint diff | "For Catalog, Blueprint maps the legacy config onto the golden pattern already live in the new account. On the left, SSH open to the world and an unencrypted disk. On the right, SSM only, KMS encryption, private subnet." | Click **Generate** on app-catalog. The diff renders |
| 3:30 | Terraform / console | "Validated and applied. That's a real instance in the new account." | Show `PROVISIONED`, and the console tab |
| 3:50 | Cutover panel | "Now we move real traffic: 10, 50, 100 percent, with health gates at every step." | Click **Cut over**. The legacy/target share chart moves |
| 4:40 | Bad wave | "Now something goes wrong on purpose. Orders ships with a missing config value." | Click **Run wave 1** (bad-wave on) |
| 5:00 | Rollback | "Errors cross 2%. Traffic snaps back to legacy in a second. No human involved. And here's the plain-English reason." | Point out the red event and the explanation |
| 5:30 | Impact | "Golden apps flow untouched, Gray apps get one human approval, Red apps go to engineers. That's how 3–4 years becomes 2027." | Impact panel |
| 5:50 | Close | "Two real AWS accounts, four agents, Claude on Bedrock, and every action logged." | — |

## If something breaks live

| Failure | Recovery line | Action |
|---|---|---|
| Terraform apply hangs | "That apply usually takes a minute. Here's the one we ran this morning." | Switch to the pre-applied app-pricing |
| Bedrock is slow | "Model's thinking. The rule-based tiering is already on screen." | Carry on; LLM text fills in later |
| Dashboard SSE disconnects | — | Refresh the page; state lives in the store |
| Everything is on fire | "Let me show you the recorded run." | A2 plays the backup video |

## Likely judge questions

- **What about databases?**
  "Stateful workloads hook into native replication: DMS, read replicas, snapshot copy. We deliberately kept the demo stateless."
- **Why not let the LLM write the Terraform?**
  "It fills inputs to a proven module, and code validates everything. Humans reviewed the pattern once, not once per app."
- **Does this scale to thousands?**
  "Agents become Step Functions tasks. Discovery reads from AWS Config aggregators. Waves run in parallel."
- **How do you stop the agent breaking things?**
  "Read-only role into legacy. Mutating tools are allowlisted to tagged resources. Rollback is deterministic code, not the model."
- **Why is anything Red?**
  "Stateful, licensed, or odd dependencies. They're parked for engineers, not forced through."
