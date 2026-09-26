# Synthetic Fleet Generator

**Owner:** A2

**Output:** `data/fleet.json`, about 1,000 `AppRecord` objects with `source: "synthetic"`, in the exact shape defined in `docs/CONTRACTS.md`.

```bash
python data/generate_fleet.py --count 1000 --seed 42 --out data/fleet.json
```

Always use a **fixed seed**, so every rehearsal shows the same numbers.

## What to randomize

| Field | Distribution |
|---|---|
| `app_id` | `syn-00001` … `syn-01000` |
| `name`, `owner` | Faker words, plus team names from a list of about 25 |
| `business_unit` | Commercial, Medicare, Medicaid, Pharmacy, Retail, Corporate |
| `runtime.type` | ec2 70%, ecs 20%, unknown 10% (tuned from 85/10/5 — non-EC2 runtimes are the main GRAY driver; at 85/10/5 GRAY landed near 13%) |
| stateful | 12%, marked in the raw config (tag `stateful=true`, a DB port open, or a 100–500 GB extra volume) — these become most of the Red tier |
| `runtime.ami_age_days` | Uniform over 30–1,400 |
| `findings` | **Left empty.** The generator emits raw config (SG rules, encryption, IMDS, tags, env values, route facts) with 35–80% probabilities, and Discovery's own rules compute findings — the same logic as for the real apps |
| `license` | none 94%, commercial 2%, byol 4% (tuned from 90/6/4 to bring Red down to ~15%) |
| dependencies | Scale-free: `barabasi_albert_graph(n, m=1)` plus a second provider for ~15% of apps, always pointing newer → older (so no cycles). Expressed as raw signals Discovery reads back: a `depends-on` tag, an env URL naming the provider (35% as an IP literal → `HARDCODED_IP`), and 50% an SG rule allowing the consumer's SG |

With seed 42 and 1,000 apps: **59.6% Golden / 25.1% Gray / 15.3% Red**, 1,135 edges,
biggest hub has 94 dependents, no isolated apps, no self or dangling dependencies.
`data/fleet.json` is committed so nobody has to regenerate it.

## Target tier mix after Discovery

These are **approximate**, so tune the probabilities until they land:

| Tier | Share |
|---|---|
| Golden | ~60% |
| Gray | ~25% |
| Red | ~15% |

## Sanity checks (the script prints these)

- Count, and the tier-mix estimate
- Maximum in-degree (the hub services) and the number of isolated apps
- No self-dependencies, and every `depends_on` ID exists
