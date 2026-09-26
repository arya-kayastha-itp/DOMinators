"""Synthetic fleet generator.

    python data/generate_fleet.py --count 1000 --seed 42 --out data/fleet.json

Emits raw config only (SG rules, encryption, IMDS, tags, env values, route
facts) with `findings` empty, so Discovery's rules compute findings exactly as
they do for the real apps. Fixed seed -> identical fleet every run.

Probabilities were tuned against agents/discovery/tiering.py (T2-F-3) to land
~60/25/15. The runtime mix is ec2 70 / ecs 20 / unknown 10 rather than the
original 85/10/5: non-EC2 runtimes are the fleet's main GRAY driver, and at
85/10/5 GRAY landed near 13%.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

import networkx as nx
from faker import Faker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.common.models import (  # noqa: E402
    AppRecord, Config, Metadata, Network, Runtime, SgRule, Source, Storage,
)

TEAMS = [f"team-{w}" for w in (
    "claims", "billing", "pharmacy", "members", "provider", "enrollment", "care", "rx", "portal", "identity",
    "payments", "eligibility", "analytics", "fraud", "notify", "docs", "search", "catalog", "orders", "pricing",
    "supply", "hr", "finance", "platform", "data")]
BUSINESS_UNITS = ["Commercial", "Medicare", "Medicaid", "Pharmacy", "Retail", "Corporate"]
KINDS = ["API", "Service", "Portal", "Worker", "Gateway", "Batch", "Engine", "Hub"]
APP_PORTS = [8080, 8080, 8080, 8443, 3000, 5000, 80, 443]
DB_PORTS = [3306, 5432, 27017, 6379]

P = {
    "runtime": {"ec2": 0.70, "ecs": 0.20, "unknown": 0.10},
    "stateful": 0.12,
    "license": {"none": 0.94, "commercial": 0.02, "byol": 0.04},
    "ssh_open": 0.55,
    "app_open": 0.60,
    "ebs_encrypted": 0.45,
    "imds_v2": 0.40,
    "public_ip": 0.50,
    "private_subnet_vpc": 0.50,
    "tag_present": 0.80,
    "hardcoded_ip": 0.35,
    "sg_ref": 0.50,
    "second_provider": 0.15,
}


def _pick(rng: random.Random, dist: dict[str, float]) -> str:
    return rng.choices(list(dist), weights=list(dist.values()))[0]


def _ip(i: int) -> str:
    return f"10.{100 + i // 62500}.{(i // 250) % 250}.{i % 250 + 1}"


def dependency_graph(count: int, seed: int, rng: random.Random) -> nx.DiGraph:
    """Scale-free, consumer -> provider, always newer -> older (so acyclic)."""
    base = nx.barabasi_albert_graph(count, 1, seed=seed)
    g = nx.DiGraph()
    g.add_nodes_from(range(count))
    for a, b in base.edges():
        g.add_edge(max(a, b), min(a, b))
    for node in range(2, count):
        if rng.random() < P["second_provider"]:
            provider = rng.randrange(0, node)
            if provider not in g.successors(node):
                g.add_edge(node, provider)
    return g


def generate(count: int, seed: int) -> list[AppRecord]:
    rng = random.Random(seed)
    fake = Faker()
    fake.seed_instance(seed)
    g = dependency_graph(count, seed, rng)
    app_id = lambda n: f"syn-{n + 1:05d}"  # noqa: E731

    ports = [rng.choice(APP_PORTS) for _ in range(count)]
    sg_ingress: dict[int, list[SgRule]] = {n: [] for n in range(count)}
    apps: list[AppRecord] = []
    for n in range(count):
        port = ports[n]
        runtime = _pick(rng, P["runtime"])
        rules = [SgRule(port=port, cidr="10.0.0.0/8")]
        if rng.random() < P["ssh_open"]:
            rules.append(SgRule(port=22, cidr="0.0.0.0/0"))
        if rng.random() < P["app_open"]:
            rules.append(SgRule(port=port, cidr="0.0.0.0/0"))

        stateful_tag, extra_gb = False, 0
        if rng.random() < P["stateful"]:
            marker = rng.choice(["tag", "db_port", "volume"])
            if marker == "tag":
                stateful_tag = True
            elif marker == "db_port":
                rules.append(SgRule(port=rng.choice(DB_PORTS), cidr="10.0.0.0/8"))
            else:
                extra_gb = rng.choice([100, 200, 500])
        sg_ingress[n].extend(rules)

        team = rng.choice(TEAMS)
        tags = {"Name": app_id(n)}
        for key, value in (("owner", team), ("cost-center", f"cc-{rng.randint(100, 999)}"),
                           ("data-class", rng.choice(["internal", "confidential", "public"]))):
            if rng.random() < P["tag_present"]:
                tags[key] = value
        if stateful_tag:
            tags["stateful"] = "true"

        providers = sorted(g.successors(n))
        env = {}
        if providers:
            tags["depends-on"] = ",".join(app_id(p) for p in providers)
            for p in providers:
                key = f"{app_id(p).upper().replace('-', '_')}_URL"
                host = _ip(p) if rng.random() < P["hardcoded_ip"] else f"{app_id(p)}.internal"
                env[key] = f"http://{host}:{ports[p]}"
                if rng.random() < P["sg_ref"]:
                    sg_ingress[p].append(SgRule(port=ports[p], source_sg=f"sg-syn{n + 1:05d}"))

        license_ = _pick(rng, P["license"])
        if license_ != "none":
            tags["license"] = license_
        apps.append(AppRecord(
            app_id=app_id(n),
            source=Source.SYNTHETIC,
            name=f"{fake.word().capitalize()} {rng.choice(KINDS)}",
            owner=tags.get("owner"),
            business_unit=rng.choice(BUSINESS_UNITS),
            runtime=Runtime(
                type=runtime,
                instance_ids=[f"i-syn{n + 1:012d}"] if runtime == "ec2" else [],
                ami_id=f"ami-syn{rng.randint(0, 99999):05d}" if runtime == "ec2" else None,
                ami_age_days=rng.randint(30, 1400),
                instance_type=rng.choice(["t3.micro", "t3.small", "m5.large", "c5.xlarge"]),
                port=port,
                stateful=stateful_tag,
            ),
            network=Network(
                vpc_id=f"vpc-syn{rng.randint(1, 40):03d}",
                vpc_has_private_subnet=rng.random() < P["private_subnet_vpc"],
                subnet_public=True,
                public_ip=rng.random() < P["public_ip"],
                private_ip=_ip(n),
                sg_ids=[f"sg-syn{n + 1:05d}"],
            ),
            storage=Storage(ebs_encrypted=rng.random() < P["ebs_encrypted"], volume_gb=rng.choice([8, 20, 50]),
                            extra_volume_gb=extra_gb),
            metadata=Metadata(imds_v2_required=rng.random() < P["imds_v2"]),
            config=Config(env=env),
            license=license_,
            tags=tags,
        ))
    # SG rules referencing consumers were appended after each provider was built.
    return [a.model_copy(update={"network": a.network.model_copy(update={"sg_ingress": sg_ingress[i]})})
            for i, a in enumerate(apps)]


def sanity(apps: list[AppRecord]) -> dict:
    from agents.discovery import discover

    ids = {a.app_id for a in apps}
    self_deps = sum(a.app_id in a.tags.get("depends-on", "").split(",") for a in apps)
    dangling = sum(p not in ids for a in apps for p in a.tags.get("depends-on", "").split(",") if p)
    _, edges, tiers = discover([], apps)
    in_deg = Counter(e.to for e in edges)
    touched = {e.from_ for e in edges} | {e.to for e in edges}
    tier_mix = Counter(t.tier.value for t in tiers)
    return {
        "count": len(apps),
        "tiers": {k: f"{tier_mix.get(k, 0)} ({100 * tier_mix.get(k, 0) / len(apps):.1f}%)" for k in ("GOLDEN", "GRAY", "RED")},
        "edges": len(edges),
        "max_in_degree": max(in_deg.values(), default=0),
        "isolated_apps": len(ids - touched),
        "self_dependencies": self_deps,
        "dangling_dependencies": dangling,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent / "fleet.json"))
    args = parser.parse_args()
    apps = generate(args.count, args.seed)
    Path(args.out).write_text(json.dumps([a.to_dict() for a in apps], indent=1) + "\n", encoding="utf-8")
    report = sanity(apps)
    print(json.dumps(report, indent=2))
    if report["self_dependencies"] or report["dangling_dependencies"]:
        sys.exit("sanity check failed: self or dangling dependencies")


if __name__ == "__main__":
    main()
