# Status — Working / Broken / Next

_Updated 2026-09-26. Track 2 (Discovery + Planning) is done; Track 3
(Blueprint + Cutover) is built and tested against fixtures and a local fake
ALB — real AWS/Terraform verification is still open (no `terraform` binary or
Account B credentials on this machine). This file is the integration
captain's running view (T2-I-1). `checklist.md` is the detailed record._

## Working

- **Framework** (`agents/common/`): contract models, SQLite store, event log,
  two-hop AWS sessions, fixture loader. `pytest` → 94 tests green (~3 min,
  mostly Cutover's real subprocess/HTTP fake-ALB tests).
- **Discovery** — `python -m agents.discovery --scope real|synthetic|all`
  - Live against Account A: 6 real apps. catalog 100, pricing 90, orders 90,
    juice-shop 100 → GOLDEN; gitea and vaultwarden → RED (`STATEFUL`), score 30.
  - Edges `orders → pricing → catalog`, each found by all 3 signals (tag, ssm, sg_ref).
  - All 10 finding codes seen in a real scan; the oracle test matches each
    instance's `findings` tag (plus D1's `HARDCODED_IP` on pricing).
  - 1,000 synthetic apps rules-only in < 3 s → 59.6 / 25.1 / 15.3.
- **Planning** — `python -m agents.planning --capacity 40 --start 2026-09-28`
  - 1,006 apps → 851 schedulable in 29 waves, 155 parked, finish 2026-12-02
    (meets 2027). Wave 0 = catalog → pricing → orders → juice-shop.
  - No consumer is ever scheduled before its provider (tested on the full fleet).
- **Fleet** — `python data/generate_fleet.py --count 1000 --seed 42` (committed as `data/fleet.json`).
- **Blueprint** — `python -m agents.blueprint --app app-catalog [--apply]`
  - Rules mapper reproduces the CONTRACTS.md `app-orders` example exactly
    (`UPSTREAM_URL` rewritten off the real dependency edge, not string
    parsing); schema validation catches leftover IPs, bad instance types,
    missing tags.
  - Diff: 7 annotated fixes for `app-catalog`, 9 each for
    `app-pricing`/`app-orders` — `fixtures/blueprint_app-*.json` regenerated
    from the real agent (all 3 real apps now, not just catalog).
  - 1,000 synthetic dry runs (map → validate → render → diff, no terraform)
    in **5.3s** (< 30s target).
  - Terraform runner, health polling and fix-&-retry are implemented and
    unit-tested against a faked `terraform` module; not yet run against a
    real `terraform` binary or Account B (needs T1-2).
- **Cutover** — `python -m agents.cutover --app app-catalog`
  - Local fake-ALB harness (`agents/cutover/fake_alb.py`): two real
    `app/server.py` processes behind a weighted proxy, same
    `modify_rule`/`describe_rules`/`describe_target_health` shape as boto3.
  - Verified against it: a clean 2-step migration follows the weights
    exactly; a bad-target run (`REQUIRE_UPSTREAM=1`, no `UPSTREAM_URL`) rolls
    back at 10% inside one observe window; an unhealthy target aborts
    precheck with weights untouched; a mid-loop exception still resets
    weights to 100/0 via the guarded `finally`.
  - Synthetic wave simulation: a 1,000-app wave (seeded, deterministic) runs
    in 1.4s at a ~2–3% rollback rate.
  - Not yet done: a real ALB run (needs T1-1), and a literal OS-level kill
    test on the demo host (only an in-process exception was exercised here).

## Broken / caveats

- **Real scan timing on the Account B owner's laptop**: ~20 s end to end
  (spec: < 10 s). The scan itself is ~5 s; the rest is machine-specific —
  Python needs 26–36 s to load certifi's CA bundle here (worked around with
  `AWS_CA_BUNDLE`, ~1.2 s per connection), and a venv inside OneDrive makes
  botocore's file reads very slow (52 s → 20 s after moving the venv to
  `%LOCALAPPDATA%\dominators-venv`). Expected 3–5 s on a normal machine.
- **LLM paths are untested**: borderline tiering (`submit_tiering`), the
  Planning rationale, Blueprint's `mapper_llm`, and Cutover's `explainer` are
  all rules/template only until Track 4's `llm.py` lands. Every decision is
  currently `decided_by=rules`, which the spec requires to work anyway.
- **Fixtures cover the 3 original apps**; Juice Shop, Gitea and Vaultwarden are
  live but still being tested, so they're not in `fixtures/` yet.
- **No `terraform` binary or Account B credentials on this machine**: Blueprint's
  terraform runner and Cutover's real `weights.py` path are implemented and
  unit-tested (mocks / the fake ALB) but not yet exercised against real
  infrastructure. Needs T1-1 (ALB describe/modify perms) and T1-2
  (`mig-tf-apply` PassRole) either way.
- **No literal process-kill test yet** for Cutover — the `finally`/signal/atexit
  rollback path is verified via an injected mid-loop exception, which is
  functionally the same guarantee, but the checklist's "kill -9 on the actual
  demo host OS" step (signal handling differs on Windows) hasn't been run for real.

## Next

- Track 4 (C1): orchestrator against the real `discovery.run` / `planning.run`
  / `blueprint.run` / `cutover.run`; `llm.py`.
- Track 3: run Blueprint and Cutover for real once Account B access + a
  `terraform` binary are available (T1-1, T1-2); a real kill test for Cutover.
- Once the 3 new apps are stable: re-record `fixtures/aws/`, extend the fixtures, register
  legacy Juice Shop in `tg-app-juice-shop-legacy`.
- `scripts/e2e_real.sh` (T2-I-3) now that Blueprint and Cutover are real.
