import argparse
import json
from datetime import date

from agents import planning

parser = argparse.ArgumentParser(prog="python -m agents.planning")
parser.add_argument("--capacity", type=int, default=40)
parser.add_argument("--waves-per-week", type=int, default=3)
parser.add_argument("--start", type=date.fromisoformat, default=None, help="YYYY-MM-DD")
args = parser.parse_args()
plan = planning.run(args.capacity, args.waves_per_week, args.start)
print(json.dumps({"plan_id": plan.plan_id, "waves": len(plan.waves), "parked": len(plan.parked),
                  "wave_0": plan.waves[0].app_ids if plan.waves else [], **plan.projection.to_dict()}, indent=2))
