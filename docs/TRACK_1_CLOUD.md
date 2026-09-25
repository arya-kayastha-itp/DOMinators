# Track 1 — Cloud

**Members:** C1, C2 (2 people). **Owns:** both AWS accounts, networking, IAM, the golden module, the edge ALB, the 3 legacy apps, and — from hour 16 — the dashboard.

This track is unchanged from the individual packets; it was already a clean 2-person track. What follows is the same content, framed as one track with an internal split, plus its interface to the other two tracks.

---

## Internal split

| | C1 | C2 |
|---|---|---|
| Hours 0–8 | Accounts, IAM roles, VPCs, peering | Legacy VPC, 3 misconfigured EC2 apps |
| Hours 8–16 | Golden module, edge ALB, Bedrock access check | Wire dependencies, build the bad-wave switch |
| Hour 16 | — | **Hard handoff: moves to dashboard** |
| Hours 16–32 | Support A3/A4 on apply and ALB weights | Dashboard build |
| Hours 32–48 | Full rebuild test, backup video, **presenter** | Dashboard polish, **demo operator** |

C1 is the track's infra half and never really blocks on C2. C2's phase 1 (legacy apps) is what Track 2 and Track 3 scan against; C2's phase 2 (dashboard) is what all four agents render into.

---

## What this track produces, and who consumes it

| Output | Consumed by | By hour |
|---|---|---|
| `mig-discovery-readonly` role, tested | Track 2 (Discovery) | 8 |
| 3 legacy apps with real findings + 3-way discoverable dependencies | Track 2 (Discovery) | 8 |
| `golden_app` variable schema | Track 3 (Blueprint) | 10 |
| Terraform state backend (bootstrap) | Track 3 (Blueprint) | 20 |
| Edge ALB: `listener_rule_arn`, `tg-<app>-target`, `tg-<app>-legacy` ARNs | Track 3 (Cutover) | 12 |
| `app-orders` reacting correctly to missing `PRICING_URL` (500 on `/`, 200 on `/health`) | Track 3 (Blueprint's bad-wave drop, Cutover's gate test) | 16 |
| Dashboard (from hour 16) | Everyone — this is what judges watch | 32 (first full dry run) |

## What this track needs from the other two tracks

| From | What | By hour |
|---|---|---|
| Track 2 | Confirmed Bedrock model ID once access is granted (so C1 knows the access request worked) | 12 (not blocking) |
| Track 2 / Track 3 | Contract shapes frozen, so the dashboard (C2) builds against something stable | 2 |

This track is the **least blocked** of the three — almost everything in hours 0–12 is buildable from Terraform alone, independent of agent progress.

---

## Checkpoints this track owns

- **Checkpoint 1 (hour 8):** 3 legacy apps respond correctly; target account can assume the legacy readonly role.
- **Hour 16:** Bad-wave switch verified working; C2 hands off to dashboard.
- **Checkpoint 2 (hour 20):** ALB fully wired; dashboard shows fleet view from fixtures.
- **Hour 36:** Full teardown/rebuild test, timed, under 20 minutes.

## Non-negotiables

- ALB **weighted target groups**, not DNS — DNS caching makes the cutover look delayed on stage.
- Bad-wave fault lives in app config only, never in security settings — the ALB health check must keep passing so it's the *traffic gate* (Track 3) that catches it, not the load balancer.
- Dashboard: one color meaning everywhere (Golden=green, Gray=amber, Red=red, Legacy=gray, Target=blue), every button has a loading state, nothing fails silently on stage.

## Definition of Done

- [ ] Both accounts provisioned from Terraform, rebuildable in under 20 minutes
- [ ] 3 legacy apps up with all 7 findings genuinely detectable, dependencies discoverable 3 ways
- [ ] Golden module + `app-hello` reference live in Account B
- [ ] Edge ALB wired, both target groups registered per app, weights start `100/0`
- [ ] Bad-wave switch verified with Track 3
- [ ] Dashboard renders all 6 tabs from live API data, survives a refresh, tested at projector resolution
- [ ] Backup video recorded from a clean rehearsal
