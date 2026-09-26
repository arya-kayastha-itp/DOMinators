"""WavePlan from AppRecord[] / Tiering[] / Edge[] — rule-based and fast.

1. RED apps are parked.
2. Consumer -> provider graph over the rest. Dependency cycles (SCCs) and
   small tightly-connected clusters (<= 5 apps) become move-together units.
3. Wave 0 = every real app that isn't parked, providers first. Then units are
   packed in dependency order: a unit is only eligible once all its providers
   are placed, and among eligible units GOLDEN goes before GRAY. GRAY apps
   count as 2 slots. A unit is never split; one bigger than a wave gets a wave
   of its own.
4. Waves are dated `waves_per_week` per week from `start_date`, skipping the
   15 Dec - 5 Jan change freeze.
"""

from __future__ import annotations

import heapq
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import networkx as nx

from agents.common.models import AppRecord, Edge, Projection, Source, Tier, Tiering, Wave, WavePlan

SMALL_CLUSTER = 5
TARGET_DATE = date(2027, 12, 31)


def _in_freeze(d: date) -> bool:
    return (d.month == 12 and d.day >= 15) or (d.month == 1 and d.day <= 5)


def wave_dates(start: date, waves_per_week: int, n: int) -> list[date]:
    """Weekdays spread evenly across each week (3/week -> Mon, Wed, Fri)."""
    per_week = max(1, min(5, waves_per_week))
    offsets = sorted({round(i * 4 / max(1, per_week - 1)) for i in range(per_week)}) if per_week > 1 else [0]
    monday = start - timedelta(days=start.weekday())
    dates: list[date] = []
    week = 0
    while len(dates) < n:
        for off in offsets:
            d = monday + timedelta(weeks=week, days=off)
            if d >= start and not _in_freeze(d):
                dates.append(d)
                if len(dates) == n:
                    break
        week += 1
    return dates


def _units(graph: nx.DiGraph) -> list[set[str]]:
    """SCCs (cycles) always move together; so does any small connected cluster."""
    units: list[set[str]] = []
    for component in nx.weakly_connected_components(graph):
        if len(component) <= SMALL_CLUSTER:
            units.append(set(component))
        else:
            units.extend(set(scc) for scc in nx.strongly_connected_components(graph.subgraph(component)))
    return units


def _providers_first(graph: nx.DiGraph, members: set[str]) -> list[str]:
    sub = graph.subgraph(members)
    try:
        return list(reversed(list(nx.lexicographical_topological_sort(sub))))
    except nx.NetworkXUnfeasible:  # a cycle inside the unit: no strict order exists
        return sorted(members)


def build_plan(
    apps: list[AppRecord],
    tiers: list[Tiering],
    edges: list[Edge],
    capacity_per_wave: int = 40,
    waves_per_week: int = 3,
    start_date: date | None = None,
    now: datetime | None = None,
) -> WavePlan:
    if capacity_per_wave < 1:
        raise ValueError("capacity_per_wave must be >= 1")
    now = now or datetime.now(timezone.utc)
    start = start_date or (now.date() + timedelta(days=1))
    tier_of = {t.app_id: t.tier for t in tiers}
    source_of = {a.app_id: a.source for a in apps}
    parked = sorted(a.app_id for a in apps if tier_of.get(a.app_id, Tier.GRAY) == Tier.RED)
    schedulable = [a.app_id for a in apps if a.app_id not in set(parked)]

    graph = nx.DiGraph()
    graph.add_nodes_from(schedulable)
    graph.add_edges_from((e.from_, e.to) for e in edges if e.from_ in graph and e.to in graph)

    slots = lambda app_id: 2 if tier_of.get(app_id) == Tier.GRAY else 1  # noqa: E731
    real = {a for a in schedulable if source_of[a] == Source.REAL}

    waves_members: list[list[str]] = []
    if real:
        waves_members.append(_providers_first(graph, real))

    rest = graph.subgraph(set(schedulable) - real).copy()
    units = _units(rest)
    unit_of = {app: i for i, members in enumerate(units) for app in members}
    unit_graph = nx.DiGraph()
    unit_graph.add_nodes_from(range(len(units)))
    for c, p in rest.edges():
        if unit_of[c] != unit_of[p]:
            unit_graph.add_edge(unit_of[c], unit_of[p])  # consumer unit -> provider unit

    def priority(u: int) -> tuple:
        members = units[u]
        gray = any(tier_of.get(a) == Tier.GRAY for a in members)
        return (gray, -len(members), min(members))

    waiting = {u: unit_graph.out_degree(u) for u in unit_graph}  # providers not yet placed
    ready = [(priority(u), u) for u, n in waiting.items() if n == 0]
    heapq.heapify(ready)
    current, used = [], 0
    while ready:
        _, u = heapq.heappop(ready)
        members = _providers_first(rest, units[u])
        cost = sum(slots(a) for a in members)
        if current and used + cost > capacity_per_wave:
            waves_members.append(current)
            current, used = [], 0
        current.extend(members)
        used += cost
        for consumer in unit_graph.predecessors(u):
            waiting[consumer] -= 1
            if waiting[consumer] == 0:
                heapq.heappush(ready, (priority(consumer), consumer))
    if current:
        waves_members.append(current)

    dates = wave_dates(start, waves_per_week, len(waves_members))
    waves = []
    for n, (members, d) in enumerate(zip(waves_members, dates)):
        mix = defaultdict(int)
        for a in members:
            mix[tier_of.get(a, Tier.GRAY)] += 1
        waves.append(Wave(
            wave=n,
            name="Pilot" if n == 0 and real else None,
            start=d,
            app_ids=members,
            tier_mix=dict(mix),
            rationale=_rationale(n, members, mix, bool(real) and n == 0),
        ))

    finish = dates[-1] if dates else None
    days = max(1, (finish - start).days + 1) if finish else 1
    return WavePlan(
        plan_id=f"plan-{now.strftime('%Y%m%d%H%M%S')}",
        generated_at=now,
        capacity_per_wave=capacity_per_wave,
        waves_per_week=waves_per_week,
        waves=waves,
        parked=parked,
        projection=Projection(
            apps_total=len(apps),
            apps_schedulable=len(schedulable),
            projected_finish=finish,
            apps_per_day=round(len(schedulable) / days, 1),
            meets_target_2027=finish is not None and finish <= TARGET_DATE,
        ),
    )


def _rationale(n: int, members: list[str], mix: dict, pilot: bool) -> str:
    """Template rationale (the LLM version is optional — T2-P-5)."""
    parts = ", ".join(f"{count} {tier.value}" for tier, count in sorted(mix.items(), key=lambda kv: kv[0].value))
    if pilot:
        return f"Real pilot apps, providers first ({' -> '.join(members)})."
    return f"Wave {n}: {len(members)} apps ({parts}); every provider is in this wave or an earlier one."
