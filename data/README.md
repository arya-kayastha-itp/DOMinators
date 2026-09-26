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
| `runtime.type` | ec2 85%, ecs 10%, unknown 5% |
| `runtime.stateful` | 12% true (these become most of the Red tier) |
| `runtime.ami_age_days` | Uniform over 30–1,400 |
| `findings` | Each finding applies independently with a probability of 30–70% |
| `license` | none 90%, commercial 6%, byol 4% |
| `depends_on` | From a scale-free graph (`networkx.barabasi_albert_graph(n, m=1..2)`): a few hub services with many dependents, and most apps with 0–3 dependencies |

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
