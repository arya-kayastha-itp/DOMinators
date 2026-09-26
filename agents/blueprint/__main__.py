import argparse
import json

from agents import blueprint

parser = argparse.ArgumentParser(prog="python -m agents.blueprint")
parser.add_argument("--app", required=True)
parser.add_argument("--apply", action="store_true")
args = parser.parse_args()
print(json.dumps(blueprint.run(args.app, apply=args.apply).to_dict(), indent=2))
