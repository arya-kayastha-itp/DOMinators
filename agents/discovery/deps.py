"""Dependency edges (consumer -> provider) from the union of three signals:
the `depends-on` tag, config values naming a provider (IP or app id), and a
provider security-group rule whose source is the consumer's security group.
Linear in the number of tags/values/rules, so it scales to the synthetic fleet."""

from __future__ import annotations

import re
from collections import defaultdict

from agents.common.models import AppRecord, Edge, EdgeSignal, Source
from agents.discovery.rules import IPV4

_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*")
_ORDER = list(EdgeSignal)


def build_edges(apps: list[AppRecord]) -> list[Edge]:
    by_id = {a.app_id: a for a in apps}
    by_ip = {a.network.private_ip: a.app_id for a in apps if a.network.private_ip}
    consumers_by_sg: dict[str, set[str]] = defaultdict(set)
    for a in apps:
        for sg in a.network.sg_ids:
            consumers_by_sg[sg].add(a.app_id)

    signals: dict[tuple[str, str], set[EdgeSignal]] = defaultdict(set)

    def add(consumer: str, provider: str, signal: EdgeSignal) -> None:
        if provider != consumer and provider in by_id:
            signals[(consumer, provider)].add(signal)

    for a in apps:
        for provider in re.split(r"[,\s]+", a.tags.get("depends-on", "")):
            if provider:
                add(a.app_id, provider, EdgeSignal.TAG)
        config_signal = EdgeSignal.SSM if a.source == Source.REAL else EdgeSignal.ENV
        for value in a.config.env.values():
            for ip in IPV4.findall(value):
                if ip in by_ip:
                    add(a.app_id, by_ip[ip], config_signal)
            for token in _TOKEN.findall(value):
                if token in by_id:
                    add(a.app_id, token, config_signal)
        for rule in a.network.sg_ingress:  # a is the provider here
            for consumer in consumers_by_sg.get(rule.source_sg or "", ()):
                add(consumer, a.app_id, EdgeSignal.SG_REF)

    return [
        Edge(from_=c, to=p, signals=sorted(s, key=_ORDER.index), source=by_id[c].source)
        for (c, p), s in sorted(signals.items())
    ]


def with_depends_on(apps: list[AppRecord], edges: list[Edge]) -> list[AppRecord]:
    providers: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        providers[e.from_].append(e.to)
    return [a.model_copy(update={"depends_on": sorted(providers.get(a.app_id, []))}) for a in apps]
