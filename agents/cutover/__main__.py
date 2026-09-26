import argparse
import json

from agents import cutover

parser = argparse.ArgumentParser(prog="python -m agents.cutover")
parser.add_argument("--app", required=True)
parser.add_argument("--observe-window", type=int, default=20)
args = parser.parse_args()
print(json.dumps(cutover.run(args.app, observe_window_s=args.observe_window).to_dict(), indent=2))
