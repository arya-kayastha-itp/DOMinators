# Status — Working / Broken / Next

_Updated 2026-09-27. Tracks 2 and 3 are done, the **full chain has run end to
end against real AWS**, and the **console is now wired to a real orchestrator**:
every button runs the real agent and every number comes from the store. This
file is the integration captain's running view (T2-I-1). `checklist.md` is the
detailed record._

## Working

- **Deployed (public)** — https://d360udbwjgf1ht.cloudfront.net : the console +
  orchestrator on a control-plane box in Account B behind CloudFront. Anyone
  with the link watches live (read-only); actions need the operator key (SSM
  `/mig/control-plane/operator_key`). Redeploy with
  `python scripts/deploy_control_plane.py`.

- **Orchestrator + console (Track 4, built by A2)** — `scripts\dev.ps1` starts
  `uvicorn orchestrator.main:app` (:8000) and the console (:3000). FastAPI with
  every CONTRACTS endpoint, background runs with per-app 409 locks, lifecycle
  checks with reasons (parked apps refused), SSE with resume, watchdog, reset
  (+ `terraform destroy`), copilot on Gemini. The console's mock layer and the
  invented Impact page are gone; Overview has a live migration board, Cutover
  draws one particle per real request and reads weights from the ALB, Blueprint
  streams terraform live. Verified live: discovery (1,006 apps, 6 real), planning
  (29 waves, finish 2026-12-02) and a real `terraform apply` of `app-catalog`
  through the API. 16 orchestrator tests.

- **End to end (T2-I-3)** — `scripts/e2e_real.sh [app]` (`--cutover-only` to
  retry step 4, `--restore` to go back to 100% legacy). Live run 2026-09-27:
  golden `app-catalog` (`i-0f3e1e4f37dc02f57`) applied and healthy, cutover
  10/50/100 on real traffic (target share 0.097 / 0.50 / 1.0, 0% errors,
  p95 ~100–120 ms) → MIGRATED → restored (10/10 requests back on `legacy`).
  Afterwards the test instance was destroyed and local state cleared, so the
  live demo starts from a clean legacy baseline.
- **Framework** (`agents/common/`): contract models, SQLite store, event log,
  two-hop AWS sessions, fixture loader. `pytest` → all green (incl. LLM + orchestrator tests).
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
- **Cutover needs a traffic generator running** — the orchestrator starts one
  per cutover; a bare `python -m agents.cutover` still needs one (the e2e script
  runs its own).
- **Screenshot tests not possible on the A2 laptop** (headless Edge is blocked by
  policy); the user drove the console in a browser instead and cut over
  app-catalog, app-pricing and app-orders to MIGRATED from the UI.
- **Juice Shop is identified by a header**: legacy and target run the same image,
  so the golden target adds `X-Served-By: target` (nginx in front) and the gate
  counts unmarked successes as legacy. Cut over live to MIGRATED this way.
- **LLM on Gemini free tier**: Bedrock is out (Account B has no Marketplace
  payment method) and watsonx is out (quota spent / project not linked). The demo
  uses `gemini-3.1-flash-lite` (~1.5 s per call); all 4 hooks ran live with 0
  fallbacks. The free tier allows about 15 requests/minute, so tiering sends at most
  10 apps per run, and running Discovery twice back to back can hit the limit. That
  costs nothing but AI answers: every hook falls back to rules. The LLM mapper
  hasn't been through a real `terraform apply` yet.
- **Parked apps**: refused by the orchestrator (409 "parked (RED)"); a direct CLI
  `blueprint.run` still wouldn't refuse.
- **Golden instances are running** in Account B for catalog, pricing, orders
  and juice-shop — all four MIGRATED, carrying 100% of their traffic. Use Reset + destroy in the
  console (Ctrl K) after the demo, so nothing keeps costing.
- **Account B owner's laptop is slow for AWS work**: Python needs 26–36 s to load
  certifi's CA bundle (worked around with `AWS_CA_BUNDLE`), and anything inside
  OneDrive (the venv, Terraform's provider cache) is slow — first
  `terraform init` for a blueprint took ~2 min. Use a venv outside OneDrive
  (`%LOCALAPPDATA%\dominators-venv`).
- **No literal process-kill test yet** for Cutover on the demo host.

## Next

- Every demo machine needs `GEMINI_*` in its `.env` (see `.env.example`) and
  `LLM_BACKEND=gemini`; check with `LLM_LIVE=1 pytest agents/tests/test_llm.py -k live`.
- Drive a real cutover and a bad-wave rollback of `app-orders` from the UI; test
  at projector resolution.
- Track 4 (C1): review the orchestrator; `tools.py` / `loop.py` are still unbuilt
  (nothing needs them yet).
- Track 3: review the gate tuning; real bad-wave run on `app-orders`; kill test.
- Register legacy Juice Shop in `tg-app-juice-shop-legacy` when the team says so.
