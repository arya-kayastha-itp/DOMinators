"""Background runs (T4-O-2, O-5, O-6, O-7, O-9).

Agents are sync boto3/subprocess code, so each run goes to a thread pool.
Every run holds one or more lock keys (`discovery`, `blueprint:app-orders`,
`app:app-orders`, ...): a second run needing a held key is refused with Busy
(HTTP 409). The orchestrator owns lifecycle transitions: `check_*` refuses
out-of-order runs (docs/FLOW.md §2) with Rejected (HTTP 409 + reason).

Real apps touch real AWS: blueprint apply is a real `terraform apply` into
Account B, cutover shifts real ALB weights while a TrafficGenerator sends
~20 req/s through the ALB. Synthetic apps never touch AWS: blueprint is a
dry run and cutover is agents/cutover/simulate.py, and their events say so
(`"sim": true`).
"""

from __future__ import annotations

import json
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from agents import blueprint, cutover, discovery, planning
from agents.blueprint import terraform
from agents.common import aws, events, store
from agents.common.models import AppStatus, EventType, Source
from agents.cutover import simulate, weights
from agents.cutover.traffic import TrafficGenerator

AGENT = "orchestrator"
WARMUP_S = 5          # traffic before the first weight change, so window 1 has samples
TAIL_S = 8            # keep traffic flowing after the result, so the chart shows where it settled
WATCHDOG_STALE_S = 5  # T4-O-9
GENERATED = aws.REPO_ROOT / "generated"

_pool = ThreadPoolExecutor(max_workers=12, thread_name_prefix="run")
_lock = threading.Lock()
_held: dict[str, str] = {}          # lock key -> run_id
_runs: dict[str, dict] = {}         # run_id -> {kind, keys, status, started, finished, error}


class Busy(Exception):
    pass


class Rejected(Exception):
    pass


# ---------------------------------------------------------------- job runner


def submit(kind: str, keys: list[str], fn, *args, **kwargs) -> str:
    with _lock:
        taken = [k for k in keys if k in _held]
        if taken:
            raise Busy(f"already running: {', '.join(taken)}")
        run_id = f"{kind}-{uuid.uuid4().hex[:8]}"
        for k in keys:
            _held[k] = run_id
        _runs[run_id] = {"run_id": run_id, "kind": kind, "keys": keys, "status": "RUNNING",
                         "started": _now(), "finished": None, "error": None}

    def job():
        try:
            fn(*args, **kwargs)
            _runs[run_id]["status"] = "DONE"
        except Exception as exc:  # noqa: BLE001 - surfaced as an ERROR event, never swallowed silently
            _runs[run_id].update(status="FAILED", error=str(exc))
            try:
                events.emit(AGENT, kwargs.get("app_id") or (args[0] if args and isinstance(args[0], str) else None),
                            EventType.ERROR, {"run": kind, "error": str(exc)[:500],
                                              "trace": traceback.format_exc(limit=3)[-800:]}, level="error")
            except Exception:  # noqa: BLE001
                pass
        finally:
            _runs[run_id]["finished"] = _now()
            with _lock:
                for k in keys:
                    if _held.get(k) == run_id:
                        del _held[k]

    _pool.submit(job)
    return run_id


def running() -> list[str]:
    """Labels like `discovery`, `cutover:app-orders`, `wave:0`, `wave:app-orders`."""
    labels = set()
    with _lock:
        for k, r in _held.items():
            kind = _runs[r]["kind"]
            if k == "store":
                continue
            if k.startswith("app:"):
                labels.add(f"{kind}:{k[4:]}")
            elif ":" in k:
                labels.add(f"{kind}:{k.split(':', 1)[1]}")
            else:
                labels.add(kind)
    return sorted(labels)


def held(key: str) -> bool:
    with _lock:
        return key in _held


def run_info(run_id: str) -> dict | None:
    return _runs.get(run_id)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def notify(message: str, app_id: str | None = None, level: str = "info", **extra) -> None:
    events.emit(AGENT, app_id, EventType.SIM_NOTIFY, {"message": message, **extra}, level=level)


# ---------------------------------------------------------------- real-app capabilities


def routes() -> dict:
    try:
        return aws.target_outputs().get("app_routes", {}) or {}
    except Exception:  # noqa: BLE001 - no target_outputs.json yet
        return {}


# How each golden_app runtime lets the cutover tell which side answered:
#   body   — the demo server returns JSON with `served_by` on both sides;
#   header — only the target marks responses (golden_app's juice-shop runtime
#            puts nginx in front adding `X-Served-By: target`), so an unmarked
#            success can only be legacy.
SIDE_MARKER = {"demo-server": "body", "juice-shop": "header"}


def capabilities() -> dict[str, dict]:
    """Per real app: can it be provisioned / cut over for real, and if not why.
    Cutover needs a way to tell which side answered each request, or the
    traffic-share gate can't tell legacy from target and would always roll back."""
    out = {}
    try:
        rule_arns = aws.target_outputs().get("listener_rule_arns", {}) or {}
    except Exception:  # noqa: BLE001
        rule_arns = {}
    for app_id, route in routes().items():
        has_rule = app_id in rule_arns
        runtime = route.get("runtime", "demo-server")
        marker = SIDE_MARKER.get(runtime)
        reason = None
        if not has_rule:
            reason = "no listener rule in Account B"
        elif not marker:
            reason = f"{runtime} responses don't say which side served them, so the traffic-share gate can't work"
        out[app_id] = {"provision": has_rule, "cutover": has_rule and bool(marker), "reason": reason,
                       "marker": marker, "runtime": runtime, "path_prefix": route.get("path_prefix"),
                       "listener_port": route.get("listener_port")}
    return out


def traffic_url(app_id: str) -> tuple[str, str]:
    out = aws.target_outputs()
    route = out["app_routes"][app_id]
    base = f"http://{out['alb_dns_name']}" + (f":{route['listener_port']}" if route.get("listener_port") else "")
    return base, (route.get("path_prefix") or "") + "/"


def elbv2():
    return cutover._default_elbv2()


# ---------------------------------------------------------------- lifecycle checks (T4-O-5)


def _app(app_id: str):
    app = {a.app_id: a for a in store.get_apps()}.get(app_id)
    if app is None:
        raise Rejected(f"unknown app {app_id} — run discovery first")
    return app


def check_blueprint(app_id: str, apply: bool):
    app = _app(app_id)
    s = app.status
    if s == AppStatus.PARKED:
        raise Rejected(f"{app_id} is parked (RED): it needs engineering before it can migrate")
    if s in (AppStatus.DISCOVERED, AppStatus.TIERED):
        raise Rejected(f"{app_id} is {s.value}: build the wave plan first")
    if s == AppStatus.CUTTING_OVER:
        raise Rejected(f"{app_id} is cutting over right now")
    if s == AppStatus.MIGRATED:
        raise Rejected(f"{app_id} is already migrated — reset the demo to run it again")
    if apply:
        if app.source != Source.REAL:
            raise Rejected("synthetic apps are dry runs only; only the real apps are applied to AWS")
        cap = capabilities().get(app_id)
        if not cap or not cap["provision"]:
            raise Rejected(f"{app_id} has no target route in Account B" + (f" ({cap['reason']})" if cap else ""))
    return app


def check_cutover(app_id: str):
    app = _app(app_id)
    if app.source != Source.REAL:
        raise Rejected("synthetic apps are cut over as part of a wave (simulated), not individually")
    cap = capabilities().get(app_id)
    if not cap or not cap["cutover"]:
        raise Rejected(f"{app_id} can't be cut over live: {cap['reason'] if cap else 'no target route'}")
    if app.status != AppStatus.PROVISIONED:
        raise Rejected(f"{app_id} is {app.status.value}: cutover needs PROVISIONED (apply its blueprint first)")
    return app


def check_retry(app_id: str):
    """Re-apply with -replace: after a rollback/failure (fix & retry), or on a
    PROVISIONED app whose golden pattern changed (user-data only takes effect
    on a fresh instance)."""
    app = _app(app_id)
    if app.source != Source.REAL or app.status not in (AppStatus.ROLLED_BACK, AppStatus.FAILED, AppStatus.PROVISIONED):
        raise Rejected(f"re-apply is for a real app that is PROVISIONED, ROLLED_BACK or FAILED ({app_id} is {app.status.value})")
    return app


# ---------------------------------------------------------------- workflows


def do_discovery(scope: str = "all") -> None:
    discovery.run(scope)


def do_planning(capacity_per_wave: int = 40, waves_per_week: int = 3) -> None:
    planning.run(capacity_per_wave=capacity_per_wave, waves_per_week=waves_per_week)


def do_blueprint(app_id: str, apply: bool) -> None:
    notify(f"Blueprint started for {app_id} · " + ("render + terraform apply into Account B" if apply else "dry run"),
           app_id, stage="blueprint_start", apply=apply)
    blueprint.run(app_id, apply=apply)


def do_retry(app_id: str) -> None:
    was = {a.app_id: a.status for a in store.get_apps()}.get(app_id)
    label = "Re-apply" if was == AppStatus.PROVISIONED else "Fix & retry"
    notify(f"{label} for {app_id} · re-render, terraform apply -replace", app_id, stage="blueprint_start", apply=True)
    blueprint.retry(app_id)


def do_cutover(app_id: str) -> None:
    base, path = traffic_url(app_id)
    header_marked = capabilities().get(app_id, {}).get("marker") == "header"
    notify(f"Traffic generator → {base}{path} at ~20 req/s"
           + (" · target identified by its X-Served-By header" if header_marked else ""), app_id)
    with TrafficGenerator(app_id, base, path, unmarked_is_legacy=header_marked):
        time.sleep(WARMUP_S)
        cutover.run(app_id)
        time.sleep(TAIL_S)


def do_wave(n: int) -> None:
    plan = store.get_plan()
    if plan is None or n >= len(plan.waves):
        raise Rejected(f"no wave {n} in the plan")
    wave = plan.waves[n]
    apps = {a.app_id: a for a in store.get_apps()}
    ids = [a for a in wave.app_ids if a in apps]
    real = [a for a in ids if apps[a].source == Source.REAL]
    synth = [a for a in ids if apps[a].source != Source.REAL]
    notify(f"Wave {n} started · {len(real)} real + {len(synth)} synthetic apps", None, wave=n)

    if synth:
        _synthetic_wave(synth)

    if real:
        caps = capabilities()
        to_apply = [a for a in real if caps.get(a, {}).get("provision")
                    and apps[a].status in (AppStatus.PLANNED, AppStatus.BLUEPRINTED, AppStatus.FAILED)]
        # Applies are independent (one state file per app): run them side by side.
        with ThreadPoolExecutor(max_workers=max(1, len(to_apply))) as pool:
            list(pool.map(lambda a: _guarded_apply(a), to_apply))
        # Cutovers one at a time, providers first (wave order already is).
        for a in real:
            status = {x.app_id: x.status for x in store.get_apps()}[a]
            if not caps.get(a, {}).get("cutover"):
                notify(f"{a}: provisioned only — {caps.get(a, {}).get('reason') or 'no live cutover'}", a, level="warn")
                continue
            if status != AppStatus.PROVISIONED:
                notify(f"{a}: skipped cutover (status {status.value})", a, level="warn")
                continue
            do_cutover(a)
    notify(f"Wave {n} finished", None, wave=n)


def _guarded_apply(app_id: str) -> None:
    try:
        do_blueprint(app_id, apply=True)
    except Exception as exc:  # noqa: BLE001 - one app failing mustn't stop the wave
        events.emit(AGENT, app_id, EventType.ERROR, {"error": str(exc)[:500]}, level="error")


def _synthetic_wave(ids: list[str]) -> None:
    by_id = {a.app_id: a for a in store.get_apps(source=Source.SYNTHETIC.value)}
    todo = [by_id[a] for a in ids if a in by_id and by_id[a].status not in (AppStatus.MIGRATED,)]
    bad = {k for k, v in json.loads(store.get_flag("bad_wave") or "{}").items() if v}
    results = [blueprint.build(a, bad_wave=a.app_id in bad) for a in todo]
    store.save_blueprints(results)
    store.upsert_apps([a.model_copy(update={"status": AppStatus.BLUEPRINTED}) for a in todo])
    events.emit_batch("blueprint", [(None, EventType.BLUEPRINT_DRY_RUN, {"app_ids": [a.app_id for a in todo[i:i + 50]]})
                                    for i in range(0, len(todo), 50)])
    simulate.simulate_wave([a.app_id for a in todo])


def set_bad_wave(app_id: str, enabled: bool) -> dict:
    flags = json.loads(store.get_flag("bad_wave") or "{}")
    flags[app_id] = bool(enabled)
    store.set_flag("bad_wave", json.dumps(flags))
    notify(f"Bad wave {'ON' if enabled else 'OFF'} for {app_id}: the next blueprint "
           + ("drops UPSTREAM_URL but keeps REQUIRE_UPSTREAM=1" if enabled else "is generated normally"),
           app_id, level="warn" if enabled else "info")
    return flags


def bad_wave_flags() -> dict:
    return {k: v for k, v in json.loads(store.get_flag("bad_wave") or "{}").items() if v}


def set_manual_weight(app_id: str, target_pct: int) -> None:
    """Break-glass: set ALB weights directly (real ALB). Refused mid-cutover."""
    if held(f"app:{app_id}"):
        raise Busy(f"{app_id} has a run in progress")
    weights.set_weights(elbv2(), app_id, target_pct)
    events.emit(AGENT, app_id, EventType.WEIGHT_SET, {"weight": target_pct, "manual": True})


def do_reset(destroy: bool) -> None:
    """T4-O-7: weights 100/0 on every rule, optionally terraform destroy every
    generated/<app>, then store.reset()."""
    try:
        rule_apps = list((aws.target_outputs().get("listener_rule_arns") or {}).keys())
    except Exception:  # noqa: BLE001
        rule_apps = []
    client = None
    for app_id in rule_apps:
        try:
            client = client or elbv2()
            weights.set_weights(client, app_id, 0)
        except Exception as exc:  # noqa: BLE001
            notify(f"reset: couldn't restore weights for {app_id}: {exc}", app_id, level="error")
    notify(f"Reset: weights 100/0 (legacy) on {len(rule_apps)} rules")

    if destroy:
        # State is remote (S3, key generated/<app>), so an instance applied from
        # another machine (a laptop, a previous box) still has state here — but
        # destroy needs the config too. Re-render it for every provisionable
        # real app we know about; destroying an app with empty state is a no-op.
        known = {a.app_id: a for a in store.get_apps(source=Source.REAL.value)}
        for app_id, cap in capabilities().items():
            if cap.get("provision") and app_id in known and not (GENERATED / app_id / "main.tf").exists():
                try:
                    blueprint.build(known[app_id])
                except Exception as exc:  # noqa: BLE001
                    notify(f"reset: couldn't render {app_id} for destroy: {str(exc)[:200]}", app_id, level="error")
    if destroy and GENERATED.exists():
        for tf_dir in sorted(p for p in GENERATED.iterdir() if (p / "main.tf").exists()):
            app_id = tf_dir.name
            try:
                notify(f"Reset: terraform destroy {app_id}", app_id)
                terraform.init(app_id, tf_dir, backend=True)
                terraform.destroy(app_id, tf_dir)
                shutil.rmtree(tf_dir, ignore_errors=True)
            except Exception as exc:  # noqa: BLE001
                notify(f"reset: destroy {app_id} failed: {str(exc)[:300]}", app_id, level="error")
    store.reset()
    notify("Demo reset: store cleared" + (", target instances destroyed" if destroy else ""), level="warn", reset=True)


# ---------------------------------------------------------------- watchdog (T4-O-9)


def watchdog_tick() -> None:
    now = datetime.now(timezone.utc)
    for app in store.get_apps(source=Source.REAL.value):
        if app.status != AppStatus.CUTTING_OVER or held(f"app:{app.app_id}"):
            continue
        beat = store.get_flag(f"cutover_heartbeat:{app.app_id}")
        age = (now - datetime.fromisoformat(beat)).total_seconds() if beat else None
        if age is not None and age < WATCHDOG_STALE_S:
            continue
        try:
            weights.set_weights(elbv2(), app.app_id, 0)
        finally:
            store.set_status(app.app_id, AppStatus.ROLLED_BACK)
            events.emit(AGENT, app.app_id, EventType.ROLLED_BACK,
                        {"reason": f"watchdog: cutover heartbeat {'stale ' + str(round(age)) + ' s' if age else 'missing'}"},
                        level="error")


def start_watchdog(interval_s: float = 1.0) -> threading.Thread:
    def loop():
        while True:
            try:
                watchdog_tick()
            except Exception:  # noqa: BLE001 - the watchdog must never die
                pass
            time.sleep(interval_s)

    t = threading.Thread(target=loop, daemon=True, name="watchdog")
    t.start()
    return t


def generated_dirs() -> list[str]:
    return sorted(p.name for p in GENERATED.iterdir() if (p / "main.tf").exists()) if GENERATED.exists() else []
