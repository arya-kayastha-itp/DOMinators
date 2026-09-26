#!/usr/bin/env bash
# End-to-end against the real accounts (T2-I-3):
#   Discovery -> Planning -> Blueprint (terraform apply into Account B) -> Cutover
#
#   scripts/e2e_real.sh [app-id]                 # default app-catalog
#   scripts/e2e_real.sh --cutover-only [app-id]  # retry step 4 only (already provisioned)
#   scripts/e2e_real.sh --restore [app-id]       # put traffic back on legacy (100/0)
#
# This is a REAL migration on shared demo infrastructure: it launches a golden
# instance in Account B and shifts live ALB traffic to it. Use --restore to put
# the app back on legacy afterwards (the golden instance is left running; destroy
# it with `terraform destroy` in generated/<app> if you don't need it).
#
# Needs: .env filled in (see .env.example), `terraform` on PATH, AWS access to
# Account B, and data/target_outputs.json. Set PYTHON if `python` isn't the
# interpreter with requirements.txt installed.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python}"

step() { printf '\n==== %s ====\n' "$*"; }
fail() { printf '\nE2E FAILED: %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" == "--restore" ]]; then
  APP="${2:-app-catalog}"
  step "Restoring $APP to 100% legacy"
  "$PY" - "$APP" <<'EOF'
import sys
from agents.common import aws
from agents.cutover import weights
app = sys.argv[1]
elbv2 = aws.agent_runner().client("elbv2")
weights.set_weights(elbv2, app, 0)
print(app, "weights now", weights.get_weights(elbv2, app))
EOF
  exit 0
fi

CUTOVER_ONLY=0
if [[ "${1:-}" == "--cutover-only" ]]; then CUTOVER_ONLY=1; shift; fi
APP="${1:-app-catalog}"

step "Preflight"
[[ -f .env ]] || fail ".env missing — copy .env.example and fill it in"
command -v terraform >/dev/null || fail "terraform not on PATH"
[[ -f data/target_outputs.json ]] || fail "data/target_outputs.json missing — export it from infra/terraform/envs/target"
"$PY" -c "import agents, boto3, networkx, jinja2, yaml" || fail "Python deps missing — pip install -r requirements.txt"
echo "ok: .env, terraform, target_outputs.json, Python deps"

if [[ "$CUTOVER_ONLY" == 0 ]]; then
  step "1/4 Discovery (real + synthetic)"
  "$PY" -m agents.discovery --scope all

  step "2/4 Planning"
  "$PY" -m agents.planning --capacity 40

  step "3/4 Blueprint $APP (terraform apply into Account B, waits for target health)"
  "$PY" -m agents.blueprint --app "$APP" --apply
fi

# Cutover's gates read TrafficSamples from the store; outside the orchestrator
# (which autostarts a generator, T4-O-8) nothing produces them, so run one here
# against the app's real ALB route for the whole cutover.
step "4/4 Cutover $APP (10 -> 50 -> 100 with traffic gates, auto-rollback)"
"$PY" - "$APP" <<'EOF'
import json, sys, time
from agents import cutover
from agents.common import aws
from agents.cutover.traffic import TrafficGenerator
app = sys.argv[1]
out = aws.target_outputs()
route = out["app_routes"][app]
base = f"http://{out['alb_dns_name']}" + (f":{route['listener_port']}" if route.get("listener_port") else "")
path = (route.get("path_prefix") or "") + "/"
print(f"traffic -> {base}{path} (~20 req/s)", flush=True)
with TrafficGenerator(app, base, path):
    time.sleep(5)  # warm-up, so the first gate window already has samples
    run = cutover.run(app)
print(json.dumps(run.to_dict(), indent=2))
EOF

step "Verdict"
"$PY" - "$APP" <<'EOF'
import sys
from agents.common import store
app = sys.argv[1]
status = {a.app_id: a.status.value for a in store.get_apps()}.get(app)
bp, cut = store.get_blueprint(app), store.get_cutover(app)
print(f"{app}: status={status} blueprint={bp.status.value if bp else None} cutover={cut.result.value if cut and cut.result else None}")
ok = bp is not None and bp.status.value == "PROVISIONED" and cut is not None and cut.result is not None and cut.result.value == "MIGRATED"
if not ok:
    reason = cut.rollback.reason if cut and cut.rollback else "see events above"
    sys.exit(f"not migrated: {reason}")
print("E2E PASSED")
EOF
