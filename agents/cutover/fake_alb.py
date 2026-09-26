"""Local fake ALB harness (T3-C-1).

Starts `app/server.py` twice (SERVED_BY=legacy / target — the "bad" target
variant sets REQUIRE_UPSTREAM=1 with no UPSTREAM_URL, same as a real bad
wave) behind a tiny weighted reverse proxy, plus a `FakeElbClient` exposing
exactly the `modify_rule` / `describe_rules` / `describe_target_health` shape
`agents/cutover/weights.py` expects from boto3's elbv2 client. Lets Cutover
be built and tested end to end with no AWS account and no dependency on
Blueprint being real yet.
"""

from __future__ import annotations

import os
import random
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from contextlib import closing
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_PY = REPO_ROOT / "app" / "server.py"


def _free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_up(port: int, path: str = "/health", timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=0.5)
            return
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0.05)
    raise RuntimeError(f"nothing came up on 127.0.0.1:{port}{path}: {last_error}")


@dataclass
class RuleState:
    legacy_arn: str
    target_arn: str
    weights: dict[str, int] = field(default_factory=lambda: {"legacy": 100, "target": 0})


class FakeElbClient:
    """Implements exactly the boto3 elbv2 calls agents/cutover/weights.py makes."""

    def __init__(self, rules: dict[str, RuleState], health: dict[str, str] | None = None):
        self._rules = rules  # rule_arn -> RuleState
        self._health = health or {}  # target_group_arn -> "healthy" | "unhealthy"

    def modify_rule(self, *, RuleArn: str, Actions: list[dict]) -> dict:
        state = self._rules[RuleArn]
        for tg in Actions[0]["ForwardConfig"]["TargetGroups"]:
            if tg["TargetGroupArn"] == state.legacy_arn:
                state.weights["legacy"] = tg["Weight"]
            elif tg["TargetGroupArn"] == state.target_arn:
                state.weights["target"] = tg["Weight"]
        return {"Rules": [self._rule_dict(RuleArn)]}

    def describe_rules(self, *, RuleArns: list[str]) -> dict:
        return {"Rules": [self._rule_dict(arn) for arn in RuleArns]}

    def _rule_dict(self, rule_arn: str) -> dict:
        state = self._rules[rule_arn]
        return {
            "RuleArn": rule_arn,
            "Actions": [{
                "Type": "forward",
                "ForwardConfig": {"TargetGroups": [
                    {"TargetGroupArn": state.legacy_arn, "Weight": state.weights["legacy"]},
                    {"TargetGroupArn": state.target_arn, "Weight": state.weights["target"]},
                ]},
            }],
        }

    def describe_target_health(self, *, TargetGroupArn: str) -> dict:
        state = self._health.get(TargetGroupArn, "healthy")
        return {"TargetHealthDescriptions": [{"Target": {"Id": "i-fake"}, "TargetHealth": {"State": state}}]}

    def set_health(self, target_group_arn: str, state: str) -> None:
        self._health[target_group_arn] = state


class _WeightedProxyHandler(BaseHTTPRequestHandler):
    alb: "FakeAlb"

    def do_GET(self):
        weights = self.alb._state.weights
        port = self.alb.target_port if random.uniform(0, 100) < weights["target"] else self.alb.legacy_port
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}{self.path}", timeout=3) as resp:
                self._respond(resp.status, resp.read())
        except urllib.error.HTTPError as exc:
            self._respond(exc.code, exc.read())
        except Exception as exc:  # noqa: BLE001 - upstream down counts as a 502, not a crash
            self._respond(502, str(exc).encode())

    def _respond(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - matches app/server.py's own silencing
        pass


class FakeAlb:
    """One app's worth of fake infrastructure: two backends, a weighted
    proxy standing in for the ALB, and the FakeElbClient view of it."""

    def __init__(self, app_id: str, *, bad_target: bool = False, upstream_url: str = ""):
        self.app_id = app_id
        self.legacy_port = _free_port()
        self.target_port = _free_port()
        self.proxy_port = _free_port()

        self._legacy_proc = self._spawn("legacy", self.legacy_port, upstream_url, require_upstream=bool(upstream_url))
        self._target_proc = self._spawn(
            "target", self.target_port, "" if bad_target else upstream_url,
            require_upstream=bool(upstream_url) or bad_target,
        )
        _wait_up(self.legacy_port)
        _wait_up(self.target_port)

        self.legacy_arn = f"arn:fake:tg:{app_id}:legacy"
        self.target_arn = f"arn:fake:tg:{app_id}:target"
        self.rule_arn = f"arn:fake:rule:{app_id}"
        self._state = RuleState(legacy_arn=self.legacy_arn, target_arn=self.target_arn)
        self.elbv2 = FakeElbClient({self.rule_arn: self._state})

        handler = type("Handler", (_WeightedProxyHandler,), {"alb": self})
        self._server = ThreadingHTTPServer(("127.0.0.1", self.proxy_port), handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True, name=f"fake-alb-{app_id}")
        self._thread.start()
        _wait_up(self.proxy_port)

    def _spawn(self, served_by: str, port: int, upstream_url: str, *, require_upstream: bool) -> subprocess.Popen:
        env = {
            **os.environ,
            "APP_ID": self.app_id,
            "SERVED_BY": served_by,
            "PORT": str(port),
            "UPSTREAM_URL": upstream_url,
            "PATH_PREFIX": "",
        }
        if require_upstream:
            env["REQUIRE_UPSTREAM"] = "1"
        else:
            env.pop("REQUIRE_UPSTREAM", None)
        return subprocess.Popen([sys.executable, str(SERVER_PY)], env=env)

    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.proxy_port}"

    def target_outputs(self) -> dict:
        """A target_outputs.json-shaped dict pointing at this fake infra —
        assign to `agents.common.aws.target_outputs` (monkeypatched) so the
        rest of the agent code needs no fake-vs-real branching."""
        return {
            "alb_dns_name": f"127.0.0.1:{self.proxy_port}",
            "vpc_id": "vpc-fake",
            "private_subnet_ids": ["subnet-fake-1", "subnet-fake-2"],
            "target_group_arns": {self.app_id: self.target_arn},
            "legacy_target_group_arns": {self.app_id: self.legacy_arn},
            "listener_rule_arns": {self.app_id: self.rule_arn},
            "app_routes": {self.app_id: {
                "path_prefix": "", "priority": 1, "port": self.target_port,
                "listener_port": None, "health_path": "/health", "runtime": "demo-server",
            }},
        }

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        for proc in (self._legacy_proc, self._target_proc):
            proc.terminate()
        for proc in (self._legacy_proc, self._target_proc):
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

    def __enter__(self) -> "FakeAlb":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
