"""Copilot: answers questions from real store facts only. The LLM (Gemini
today) phrases the answer from a facts block and is told to say so when the
facts don't cover the question. If the LLM is off or refuses (e.g. the free
tier's ~15 req/min), the facts themselves are returned — never an invented
answer."""

from __future__ import annotations

import json
import os
import re

from agents.common import llm, store
from orchestrator import stats

SYSTEM = (
    "You are the copilot of a cloud migration accelerator dashboard. Answer the user's question "
    "using ONLY the JSON facts provided. Be concise (at most 5 short sentences or bullets), give exact "
    "numbers from the facts, and never invent apps, numbers, dates or costs. If the facts don't answer "
    "the question, say that plainly and suggest which page of the console to look at."
)

APP_RE = re.compile(r"\b(app-[a-z0-9-]+|syn-\d{5})\b")


def facts_for(question: str) -> dict:
    s = stats.summary()
    facts: dict = {k: s[k] for k in ("apps_total", "real", "synthetic", "tiers", "tiers_real", "statuses_real",
                                     "statuses_synthetic", "findings", "findings_real", "edges", "llm_decisions",
                                     "real_apps", "plan", "cutovers_real")}
    plan = store.get_plan()
    if plan:
        facts["first_waves"] = [{"wave": w.wave, "start": w.start.isoformat(), "apps": len(w.app_ids),
                                 "tier_mix": {k.value: v for k, v in w.tier_mix.items()},
                                 "rationale": w.rationale} for w in plan.waves[:3]]
    ids = set(APP_RE.findall(question.lower()))
    if ids:
        apps = {a.app_id: a for a in store.get_apps()}
        tiers = {t.app_id: t for t in store.get_tiers()}
        facts["apps_asked_about"] = {}
        for i in sorted(ids):
            if i not in apps:
                facts["apps_asked_about"][i] = "not found"
                continue
            bp, cut = store.get_blueprint(i), store.get_cutover(i)
            facts["apps_asked_about"][i] = {
                "record": apps[i].model_dump(mode="json", exclude={"tags"}),
                "tiering": tiers[i].to_dict() if i in tiers else None,
                "blueprint_fixes": [f.to_dict() for f in bp.fixes] if bp else None,
                "cutover": cut.to_dict() if cut else None,
            }
    return facts


def answer(question: str) -> dict:
    facts = facts_for(question)
    model = os.getenv("GEMINI_MODEL") if llm.backend() == "gemini" else (llm.backend() if llm.backend() != "off" else None)
    try:
        text = llm.complete(SYSTEM, f"Facts:\n{json.dumps(facts, default=str)}\n\nQuestion: {question}", max_tokens=400)
        return {"answer": text, "model": model, "fallback": False, "facts": sorted(facts.keys())}
    except Exception as exc:  # noqa: BLE001 - facts-only answer instead of nothing
        s = stats.summary()
        lines = [f"{s['apps_total']} apps discovered ({s['real']} real, {s['synthetic']} synthetic) · tiers "
                 + ", ".join(f"{k} {v}" for k, v in s["tiers"].items())]
        if s["plan"]:
            p = s["plan"]["projection"]
            lines.append(f"Plan: {s['plan']['waves']} waves, {s['plan']['parked']} parked, projected finish "
                         f"{p['projected_finish']} ({'meets' if p['meets_target_2027'] else 'misses'} the 2027 target)")
        for a in s["real_apps"]:
            lines.append(f"{a['app_id']}: {a['status']} · {a['tier']} · {a['findings']} findings")
        return {"answer": "The language model isn't available right now "
                          f"({type(exc).__name__}), so here are the facts:\n- " + "\n- ".join(lines),
                "model": None, "fallback": True, "facts": sorted(facts.keys())}
