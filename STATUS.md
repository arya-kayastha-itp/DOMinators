# Status — Working / Broken / Next

_Updated 2026-09-26. Track 2 (Discovery + Planning) is done; this file is the
integration captain's running view (T2-I-1). `checklist.md` is the detailed record._

## Working

- **Framework** (`agents/common/`): contract models, SQLite store, event log,
  two-hop AWS sessions, fixture loader. `pytest` → 53 tests green in ~30 s.
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
- **Stubs** for Blueprint and Cutover, so the orchestrator can call all 4 agents today.

## Broken / caveats

- **Real scan timing on the Account B owner's laptop**: ~20 s end to end
  (spec: < 10 s). The scan itself is ~5 s; the rest is machine-specific —
  Python needs 26–36 s to load certifi's CA bundle here (worked around with
  `AWS_CA_BUNDLE`, ~1.2 s per connection), and a venv inside OneDrive makes
  botocore's file reads very slow (52 s → 20 s after moving the venv to
  `%LOCALAPPDATA%\dominators-venv`). Expected 3–5 s on a normal machine.
- **LLM paths are untested**: borderline tiering (`submit_tiering`) and the
  Planning rationale are rules/template only until Track 4's `llm.py` lands.
  Every decision is currently `decided_by=rules`, which the spec requires to work anyway.
- **Fixtures cover the 3 original apps**; Juice Shop, Gitea and Vaultwarden are
  live but still being tested, so they're not in `fixtures/` yet.

## Next

- Track 4 (C1): orchestrator against the real `discovery.run` / `planning.run`; `llm.py`.
- Track 3: real Blueprint + Cutover replacing the stubs; review the blueprint/cutover/traffic fixtures.
- Once the 3 new apps are stable: re-record `fixtures/aws/`, extend the fixtures, register
  legacy Juice Shop in `tg-app-juice-shop-legacy`.
- `scripts/e2e_real.sh` (T2-I-3) once Blueprint and Cutover are real.
