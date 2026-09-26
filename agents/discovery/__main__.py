import argparse
import json

from agents import discovery

parser = argparse.ArgumentParser(prog="python -m agents.discovery")
parser.add_argument("--scope", choices=["real", "synthetic", "all"], default="all")
args = parser.parse_args()
print(json.dumps(discovery.run(args.scope).to_dict(), indent=2))
