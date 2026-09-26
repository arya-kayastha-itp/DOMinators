# Status — Working / Broken / Next

_Updated 2026-09-27. Tracks 2 and 3 are done, and the **full chain has now run
end to end against real AWS**: `scripts/e2e_real.sh` migrated `app-catalog`
live (Discovery → Planning → Terraform apply → gated cutover → MIGRATED), then
restored it to legacy. This file is the integration captain's running view
(T2-I-1). `checklist.md` is the detailed record._

## Working

- **End to end (T2-I-3)** — `scripts/e2e_real.sh [app]` (`--cutover-only` to
  retry step 4, `--restore` to go back to 100% legacy). Live run 2026-09-27:
  golden `app-catalog` (`i-0f3e1e4f37dc02f57`) applied and healthy, cutover
  10/50/100 on real traffic (target share 0.097 / 0.50 / 1.0, 0% errors,
  p95 ~100–120 ms) → MIGRATED → restored (10/10 requests back on `legacy`).
  Afterwards the test instance was destroyed and local state cleared, so the
  live demo starts from a clean legacy baseline.
- **Framework** (`agents/common/`): contract models, SQLite store, event log,
  two-hop AWS sessions, fixture loader. `pytest` → 94 tests green.
- **Discovery** — `python -m agents.discovery --scope real|synthetic|all`
  - Live against Account A: 6 real apps. catalog 100, pricing 90, orders 90,
    juice-shop 100 → GOLDEN; gitea and vaultwarden → RED (`STATEFUL`), score 30.
  - Edges `orders → pricing → catalog`, each found by all 3 signals.
  - All 10 finding codes seen in a real scan; the oracle test matches all 6
    instances' `findings` tags (plus D1's `HARDCODED_IP` on pricing).
  - 1,000 synthetic apps rules-only in < 3 s → 59.6 / 25.1 / 15.3.
- **Planning** — 1,006 apps → 851 schedulable in 29 waves, 155 parked, finish
  2026-12-02 (meets 2027). Wave 0 = catalog → pricing → orders → juice-shop.
- **Fixtures** — all 6 real apps, rebuilt from recorded responses by
  `scripts/build_fixtures.py` (real Discovery + Planning, pinned clock).
- **Blueprint** — rules mapper, schema validation, 7–9 annotated fixes per real
  app, 1,000 synthetic dry runs in ~5 s; **real `terraform apply` verified** on
  `app-catalog`.
- **Cutover** — fake-ALB harness + synthetic wave sim (Track 3), and now a
  **real ALB run**: T1-1 applied, so `mig-agent-runner` can describe and
  modify the (now tagged) listener rules.

## Broken / caveats

- **Cutover timing on the real ALB**: ~110 s for 10/50/100, not 60–90 s. The ALB
  keeps sending 0% to the new target for ~12 s after a weight change; the first
  live run (`settle_s` 2) rolled back with target share 0.03. `config.yaml` is now
  `settle_s` 15 / `observe_window_s` 35 / `min_target_share_ratio` 0.6 (see its
  comments) — Track 3 to review.
- **Cutover needs a traffic generator running** — outside the orchestrator
  (T4-O-8) nothing produces samples and the gate fails with "0 requests". The
  e2e script runs one; the orchestrator must too.
- **LLM: moving to watsonx.ai**: Bedrock can't be used (Account B has no payment
  method for AWS Marketplace). `agents/common/llm.py` now has a `watsonx` backend
  (Granite) with Gemini as the automatic fallback. All 4 hooks (tiering, Planning
  pilot rationale, `mapper_llm`, `explainer`) pass on `mock`; the live watsonx run
  waits for keys in `.env`. `.env` stays `LLM_BACKEND=off` until then, and every
  hook falls back to rules on any LLM failure.
- **Parked apps are only parked by Planning**: Gitea/Vaultwarden are RED → parked
  and have no target group or rule in Account B, but `blueprint.run` /
  `cutover.run` don't refuse a RED app themselves — the orchestrator's lifecycle
  check (T4-O-5) has to.
- **Account B owner's laptop is slow for AWS work**: Python needs 26–36 s to load
  certifi's CA bundle (worked around with `AWS_CA_BUNDLE`), and anything inside
  OneDrive (the venv, Terraform's provider cache) is slow — first
  `terraform init` for a blueprint took ~2 min. Use a venv outside OneDrive
  (`%LOCALAPPDATA%\dominators-venv`).
- **No literal process-kill test yet** for Cutover on the demo host.

## Next

- Fill `WATSONX_*` (and optionally `GEMINI_API_KEY`) in `.env`, set
  `LLM_BACKEND=watsonx`, run `LLM_LIVE=1 pytest agents/tests/test_llm.py -k live`.
- Track 4 (C1): orchestrator on the real agents (must autostart the traffic
  generator, T4-O-8); `tools.py` / `loop.py`.
- Track 3: review the gate tuning; real bad-wave run on `app-orders`; kill test.
- Register legacy Juice Shop in `tg-app-juice-shop-legacy` when the team says so.
