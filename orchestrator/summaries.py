"""One-line human summaries for events, built only from the event's own
payload (the console renders them in feeds). Also maps a few terminal event
types to the UI's `success` level; the store keeps info/warn/error."""

from __future__ import annotations

from agents.common.models import Event

SUCCESS = {"DISCOVERY_DONE", "PLAN_DONE", "PROVISIONED", "GATE_PASS", "MIGRATED", "BLUEPRINT_READY"}


def _pct(x) -> str:
    try:
        return f"{float(x) * 100:.1f}%"
    except (TypeError, ValueError):
        return "?"


def summarize(e: Event) -> str:
    p, t, app = e.payload or {}, e.type.value, e.app_id or ""
    sim = " (simulated)" if p.get("sim") else ""
    if t == "DISCOVERY_STARTED":
        return f"Discovery started · scope {p.get('scope', 'all')}"
    if t == "APP_DISCOVERED":
        if "app_ids" in p:
            return f"{len(p['app_ids'])} synthetic apps discovered and tiered"
        tier = p.get("tier")
        n = p.get("findings")
        n = len(n) if isinstance(n, list) else n
        bits = [x for x in (f"{n} findings" if n is not None else None, tier) if x]
        return f"{app} discovered" + (f" · {' · '.join(bits)}" if bits else "")
    if t == "DISCOVERY_DONE":
        tiers = p.get("tiers") or {}
        mix = " / ".join(f"{k} {v}" for k, v in tiers.items())
        ms = p.get("duration_ms")
        return (f"Discovery complete · {p.get('apps_total', '?')} apps ({p.get('real', '?')} real)"
                + (f" · {mix}" if mix else "") + (f" · {ms / 1000:.1f} s" if isinstance(ms, (int, float)) else ""))
    if t == "PLAN_DONE":
        fin = p.get("projected_finish")
        meets = p.get("meets_target_2027")
        return (f"Wave plan ready · {p.get('waves', '?')} waves, {p.get('parked', '?')} parked"
                + (f" · finish {fin}" if fin else "") + (" · meets 2027 target" if meets else (" · misses 2027 target" if meets is False else "")))
    if t == "TOOL_CALL":
        tool, line = p.get("tool", "tool"), p.get("line")
        return f"{tool} │ {line}" if line is not None else str(tool)
    if t == "BLUEPRINT_READY":
        return f"{app} blueprint rendered · {p.get('fixes', 0)} fixes · validate {'✓' if p.get('validate_ok') else '✗'}"
    if t == "BLUEPRINT_DRY_RUN":
        if "app_ids" in p:
            return f"{len(p['app_ids'])} synthetic blueprints dry-run (map → validate → render → diff)"
        return f"{app} blueprint dry-run · {p.get('fixes', 0)} fixes, {p.get('gaps', 0)} gaps"
    if t == "PROVISIONED":
        ids = (p.get("outputs") or {}).get("instance_ids") or []
        return f"{app} provisioned in Account B · target healthy" + (f" · {', '.join(ids)}" if ids else "")
    if t == "BLUEPRINT_FAILED":
        return f"{app} blueprint failed at {p.get('step', '?')}" + (f": {str(p.get('error'))[:160]}" if p.get("error") else "")
    if t == "CUTOVER_STARTED":
        return f"{app} cutover started · steps {'/'.join(str(s) for s in p.get('steps', []))}%{sim}"
    if t == "WEIGHT_SET":
        w = p.get("weight")
        manual = " (manual)" if p.get("manual") else ""
        return f"{app} ALB weights → {100 - int(w)}/{w} legacy/target{manual}{sim}" if w is not None else f"{app} weights set"
    if t == "GATE_PASS":
        extra = ""
        if "error_rate" in p:
            extra = f" · errors {_pct(p['error_rate'])} · p95 {p.get('p95_ms', 0):.0f} ms · target {_pct(p.get('target_share'))}"
        return f"{app} gate passed at {p.get('weight')}%{extra}{sim}"
    if t == "GATE_FAIL":
        reasons = p.get("reasons")
        return f"{app} gate FAILED at {p.get('weight')}%" + (f" · {'; '.join(reasons)}" if reasons else "") + sim
    if t == "ROLLED_BACK":
        why = p.get("reason", "")
        at = p.get("at_weight")
        return f"{app} rolled back" + (f" at {at}%" if at is not None else "") + " · weights 100/0" + (f" · {why}" if why else "")
    if t == "MIGRATED":
        return f"{app} migrated · 100% on the golden pattern{sim}"
    if t == "CUTOVER_ABORTED":
        return f"{app} cutover aborted · {p.get('reason', '')}"
    if t == "SIM_DECOMMISSION":
        return f"{app} legacy instance queued for decommission (simulated)"
    if t == "SIM_NOTIFY":
        return str(p.get("message") or p.get("summary") or "notice")
    if t == "LLM_FALLBACK":
        return f"LLM unavailable → rules · {str(p.get('reason', ''))[:160]}"
    if t == "ERROR":
        return f"{app + ' · ' if app else ''}error: {str(p.get('error', ''))[:200]}"
    return t


def to_console(e: Event) -> dict:
    d = e.to_dict()
    d["summary"] = summarize(e)
    if e.type.value in SUCCESS and e.level == "info":
        d["level"] = "success"
    return d
