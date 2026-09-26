"""Serve recorded AWS responses (fixtures/aws/<operation>.json) as a boto3-like client."""

import json
from pathlib import Path

RECORDED = Path(__file__).resolve().parents[2] / "fixtures" / "aws"


class _Paginator:
    def __init__(self, client, op):
        self.client, self.op = client, op

    def paginate(self, **kwargs):
        self.client.calls.append((self.op, kwargs))
        return iter(self.client.pages(self.op))


class FakeClient:
    def __init__(self, overrides: dict | None = None):
        self.calls: list[tuple[str, dict]] = []
        self.overrides = overrides or {}

    def pages(self, op):
        if op in self.overrides:
            return self.overrides[op]
        return json.loads((RECORDED / f"{op}.json").read_text(encoding="utf-8"))

    def can_paginate(self, op):
        return True

    def get_paginator(self, op):
        return _Paginator(self, op)

    def __getattr__(self, op):
        def call(**kwargs):
            self.calls.append((op, kwargs))
            return self.pages(op)[0]
        return call
