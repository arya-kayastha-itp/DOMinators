"""FastAPI app: every endpoint in docs/CONTRACTS.md (+ addendum), plus what the
console needs to show real data only: /fleet (apps joined with tiers),
/summary (all headline numbers), /plan/preview (the real planner for the
capacity slider), /weights (live ALB weights), /traffic (per-second buckets
of the generator's real requests) and /copilot.

    uvicorn orchestrator.main:app --port 8000
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from agents import cutover
from agents.blueprint import terraform
from agents.common import aws, events, llm, store
from agents.common.models import Source
from agents.cutover import weights
from agents.planning.planner import build_plan
from orchestrator import copilot, runs, stats
from orchestrator.summaries import to_console

SSE_POLL_S = 0.15
SSE_PING_S = 15


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.conn()
    if os.getenv("ORCH_WATCHDOG", "1") == "1":
        runs.start_watchdog()
    yield


app = FastAPI(title="Migration accelerator orchestrator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(runs.Busy)
async def _busy(_req, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc), "kind": "busy"})


@app.exception_handler(runs.Rejected)
async def _rejected(_req, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc), "kind": "lifecycle"})


# ---------------------------------------------------------------- operator key
# The deployed console is public and read-only for viewers; anything that
# changes AWS or the store needs the operator key (OPERATOR_KEY env). Unset =
# open, for local development.


def _operator_key() -> str:
    return os.getenv("OPERATOR_KEY", "").strip()


def _key_ok(request: Request) -> bool:
    key = _operator_key()
    return not key or hmac.compare_digest(request.headers.get("x-operator-key", "").encode(), key.encode())


def require_operator(request: Request) -> None:
    if not _key_ok(request):
        raise HTTPException(401, "operator key required — this action changes AWS or the migration state")


@app.get("/auth")
def auth(request: Request):
    return {"operator_required": bool(_operator_key()), "valid": _key_ok(request)}


# Copilot is open to viewers, so it's rate limited to stay inside the LLM's
# free-tier quota (~15 req/min) and keep one visitor from using it all.
COPILOT_PER_CLIENT, COPILOT_GLOBAL, COPILOT_WINDOW_S = 4, 10, 60
_copilot_hits: dict[str, deque] = defaultdict(deque)
_copilot_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?")


def _copilot_allowed(request: Request) -> bool:
    if _key_ok(request) and _operator_key():
        return True  # the operator is never throttled
    now = time.monotonic()
    with _copilot_lock:
        for q in (_copilot_hits["*"], _copilot_hits[_client_ip(request)]):
            while q and now - q[0] > COPILOT_WINDOW_S:
                q.popleft()
        if len(_copilot_hits["*"]) >= COPILOT_GLOBAL or len(_copilot_hits[_client_ip(request)]) >= COPILOT_PER_CLIENT:
            return False
        _copilot_hits["*"].append(now)
        _copilot_hits[_client_ip(request)].append(now)
    return True


def _accepted(run_id: str) -> JSONResponse:
    return JSONResponse(status_code=202, content={"run_id": run_id, "status": "STARTED"})


# ---------------------------------------------------------------- health + state


@app.get("/healthz")
def healthz():
    try:
        store.conn().execute("SELECT 1")
        st = "ok"
    except Exception as exc:  # noqa: BLE001
        st = f"error: {exc}"
    return {"ok": st == "ok", "store": st, "llm_backend": llm.backend(), "llm_model": _llm_model(),
            "terraform": terraform.available(), "target_outputs": bool(runs.routes())}


def _llm_model() -> str | None:
    b = llm.backend()
    return {"gemini": os.getenv("GEMINI_MODEL"), "watsonx": os.getenv("WATSONX_MODEL_ID"),
            "bedrock": os.getenv("LLM_MODEL_ID"), "anthropic": os.getenv("LLM_MODEL_ID")}.get(b)


@app.get("/demo/state")
def demo_state():
    cfg = cutover.load_config()
    try:
        out = aws.target_outputs()
        target = {"alb_dns_name": out.get("alb_dns_name"), "region": aws.region(),
                  "account_id": out.get("account_id") or "408336117553"}
    except Exception:  # noqa: BLE001
        target = None
    return {
        "bad_wave": runs.bad_wave_flags(),
        "running": runs.running(),
        "capabilities": runs.capabilities(),
        "cutover_config": {"steps": cfg.get("steps"), "observe_window_s": cfg.get("observe_window_s"),
                           "settle_s": cfg.get("settle_s"), "min_requests": cfg.get("min_requests"),
                           "gates": cfg.get("gates")},
        "llm": {"backend": llm.backend(), "model": _llm_model()},
        "target": target,
        "generated": runs.generated_dirs(),
    }


@app.get("/summary")
def summary():
    return stats.summary()


# ---------------------------------------------------------------- read models


@app.get("/apps")
def list_apps(source: str | None = None):
    return [a.to_dict() for a in store.get_apps(source)]


@app.get("/apps/{app_id}")
def get_app(app_id: str):
    app_ = {a.app_id: a for a in store.get_apps()}.get(app_id)
    if not app_:
        raise HTTPException(404, f"unknown app {app_id}")
    return app_.to_dict()


@app.get("/fleet")
def fleet():
    """AppRecord + its Tiering, one row per app (what the Fleet table needs)."""
    tiers = {t.app_id: t for t in store.get_tiers()}
    out = []
    for a in store.get_apps():
        t = tiers.get(a.app_id)
        row = a.to_dict()
        row["tier"] = t.tier.value if t else None
        row["score"] = t.score if t else None
        row["tiering"] = t.to_dict() if t else None
        out.append(row)
    return out


@app.get("/statuses")
def statuses():
    rows = store.conn().execute("SELECT app_id, status FROM apps").fetchall()
    return {r[0]: r[1] for r in rows}


@app.get("/tiers")
def tiers():
    return [t.to_dict() for t in store.get_tiers()]


@app.get("/edges")
def edges():
    return [e.to_dict() for e in store.get_edges()]


@app.get("/plan")
def plan():
    p = store.get_plan()
    return p.to_dict() if p else None


@app.get("/plan/preview")
def plan_preview(capacity_per_wave: int = 40, waves_per_week: int = 3):
    """The real planner, not saved — drives the capacity slider."""
    if not 1 <= capacity_per_wave <= 200 or not 1 <= waves_per_week <= 5:
        raise HTTPException(422, "capacity_per_wave 1-200, waves_per_week 1-5")
    apps = store.get_apps()
    if not apps:
        return None
    return build_plan(apps, store.get_tiers(), store.get_edges(), capacity_per_wave, waves_per_week).to_dict()


@app.get("/blueprints")
def blueprints(source: str = "real"):
    ids = [a.app_id for a in store.get_apps(source)]
    return {i: b.to_dict() for i in ids if (b := store.get_blueprint(i))}


@app.get("/blueprints/{app_id}")
def get_blueprint(app_id: str):
    b = store.get_blueprint(app_id)
    return b.to_dict() if b else None


@app.get("/cutovers")
def cutovers(source: str = "real"):
    ids = [a.app_id for a in store.get_apps(source)]
    return {i: c.to_dict() for i in ids if (c := store.get_cutover(i))}


@app.get("/cutovers/{app_id}")
def get_cutover(app_id: str):
    c = store.get_cutover(app_id)
    return c.to_dict() if c else None


@app.get("/traffic/{app_id}")
def traffic(app_id: str, seconds: int = 90):
    """Real requests from the traffic generator, bucketed per second."""
    buckets: dict[int, list] = defaultdict(list)
    for s in store.traffic_window(app_id, min(max(seconds, 5), 900)):
        buckets[int(s.ts.timestamp())].append(s)
    out = []
    for t in sorted(buckets):
        ss = buckets[t]
        lat = sorted(x.latency_ms for x in ss)
        out.append({
            "t": t, "n": len(ss),
            "target": sum(x.served_by.value == "target" for x in ss),
            "legacy": sum(x.served_by.value == "legacy" for x in ss),
            "unknown": sum(x.served_by.value == "unknown" for x in ss),
            "errors": sum(x.status == 0 or x.status >= 500 for x in ss),
            "p95_ms": round(lat[max(0, int(0.95 * len(lat)) - 1)], 1) if lat else None,
        })
    return out


_weights_cache: dict[str, tuple[float, dict]] = {}


@app.get("/weights/{app_id}")
def live_weights(app_id: str):
    """Read straight from the ALB (cached 2 s so a polling page can't hammer it)."""
    hit = _weights_cache.get(app_id)
    if hit and time.monotonic() - hit[0] < 2:
        return hit[1]
    try:
        client = runs.elbv2()
        w = weights.get_weights(client, app_id)
        healthy = weights.target_healthy(client, app_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"ALB read failed: {exc}") from exc
    body = {"app_id": app_id, **w, "target_healthy": healthy, "read_at": time.time()}
    _weights_cache[app_id] = (time.monotonic(), body)
    return body


# ---------------------------------------------------------------- events


def _max_event_id() -> int:
    row = store.conn().execute("SELECT MAX(id) FROM events").fetchone()
    return row[0] or 0


@app.get("/events/recent")
def recent_events(limit: int = 400, app_id: str | None = None, type: str | None = None):
    sql, args = "SELECT id FROM events", []
    where = []
    if app_id:
        where.append("app_id = ?")
        args.append(app_id)
    if type:
        where.append("type = ?")
        args.append(type)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    args.append(min(limit, 5000))
    ids = [r[0] for r in store.conn().execute(sql, args).fetchall()]
    if not ids:
        return {"events": [], "last_id": _max_event_id()}
    lo = min(ids)
    evs = [e for e in events.events_since(lo - 1) if e.id in set(ids)]
    return {"events": [to_console(e) for e in evs], "last_id": _max_event_id()}


@app.get("/events")
async def stream_events(request: Request, after: int | None = None):
    """SSE (T4-O-4). Resumes from Last-Event-ID; sends `event: reset` when the
    store was reset under the client (ids restart), and a ping every 15 s."""
    header = request.headers.get("last-event-id")
    last = int(header) if header and header.isdigit() else (after if after is not None else _max_event_id())

    async def gen():
        nonlocal last
        quiet = 0.0
        yield "retry: 1500\n\n"
        while not await request.is_disconnected():
            top = await asyncio.to_thread(_max_event_id)
            if top < last:
                last = 0
                yield "event: reset\ndata: {}\n\n"
            rows = await asyncio.to_thread(events.events_since, last) if top > last else []
            for e in rows[:2000]:
                last = e.id
                yield f"id: {e.id}\ndata: {json.dumps(to_console(e), default=str)}\n\n"
            if rows:
                quiet = 0.0
            else:
                quiet += SSE_POLL_S
                if quiet >= SSE_PING_S:
                    quiet = 0.0
                    yield ": ping\n\n"
            await asyncio.sleep(SSE_POLL_S)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- runs


class DiscoveryBody(BaseModel):
    scope: str = Field("all", pattern="^(real|synthetic|all)$")


class PlanningBody(BaseModel):
    capacity_per_wave: int = Field(40, ge=1, le=200)
    waves_per_week: int = Field(3, ge=1, le=5)


@app.post("/runs/discovery", dependencies=[Depends(require_operator)])
def run_discovery(body: DiscoveryBody | None = None):
    # Discovery re-tiers every app (status -> TIERED), so it must not run
    # underneath a blueprint/cutover that's moving an app forward.
    if runs.running():
        raise runs.Busy(f"can't re-run discovery while running: {', '.join(runs.running())}")
    return _accepted(runs.submit("discovery", ["discovery", "store"], runs.do_discovery, (body or DiscoveryBody()).scope))


@app.post("/runs/planning", dependencies=[Depends(require_operator)])
def run_planning(body: PlanningBody | None = None):
    b = body or PlanningBody()
    if not store.get_apps():
        raise runs.Rejected("no apps in the store — run discovery first")
    return _accepted(runs.submit("planning", ["planning", "store"], runs.do_planning, b.capacity_per_wave, b.waves_per_week))


@app.post("/runs/blueprint/{app_id}", dependencies=[Depends(require_operator)])
def run_blueprint(app_id: str, apply: bool = False):
    app_ = runs.check_blueprint(app_id, apply)
    apply = apply and app_.source == Source.REAL
    return _accepted(runs.submit("blueprint", [f"app:{app_id}"], runs.do_blueprint, app_id, apply))


@app.post("/runs/retry/{app_id}", dependencies=[Depends(require_operator)])
def run_retry(app_id: str):
    runs.check_retry(app_id)
    return _accepted(runs.submit("retry", [f"app:{app_id}"], runs.do_retry, app_id))


@app.post("/runs/cutover/{app_id}", dependencies=[Depends(require_operator)])
def run_cutover(app_id: str):
    runs.check_cutover(app_id)
    return _accepted(runs.submit("cutover", [f"app:{app_id}"], runs.do_cutover, app_id))


@app.post("/runs/wave/{n}", dependencies=[Depends(require_operator)])
def run_wave(n: int):
    plan_ = store.get_plan()
    if plan_ is None:
        raise runs.Rejected("no wave plan yet — run planning first")
    if not 0 <= n < len(plan_.waves):
        raise runs.Rejected(f"the plan has waves 0-{len(plan_.waves) - 1}")
    real = [a.app_id for a in store.get_apps(Source.REAL.value) if a.app_id in set(plan_.waves[n].app_ids)]
    return _accepted(runs.submit("wave", [f"wave:{n}", *(f"app:{a}" for a in real)], runs.do_wave, n))


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    info = runs.run_info(run_id)
    if not info:
        raise HTTPException(404, "unknown run")
    return info


# ---------------------------------------------------------------- demo controls


class BadWaveBody(BaseModel):
    app_id: str = "app-orders"
    enabled: bool = True


class WeightBody(BaseModel):
    target_pct: int = Field(..., ge=0, le=100)


class CopilotBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)


@app.post("/demo/bad-wave", dependencies=[Depends(require_operator)])
def bad_wave(body: BadWaveBody):
    return {"bad_wave": runs.set_bad_wave(body.app_id, body.enabled)}


@app.post("/demo/weights/{app_id}", dependencies=[Depends(require_operator)])
def manual_weight(app_id: str, body: WeightBody):
    runs.set_manual_weight(app_id, body.target_pct)
    _weights_cache.pop(app_id, None)
    return {"ok": True}


@app.post("/demo/reset", dependencies=[Depends(require_operator)])
def reset(destroy: bool = False):
    if runs.running():
        raise runs.Busy(f"can't reset while running: {', '.join(runs.running())}")
    return _accepted(runs.submit("reset", ["reset", "store", "discovery", "planning"], runs.do_reset, destroy))


@app.post("/copilot")
def ask(body: CopilotBody, request: Request):
    if not _copilot_allowed(request):
        raise HTTPException(429, "Copilot is busy — too many questions this minute. Try again shortly.")
    return copilot.answer(body.question)
