"""Traffic generator (T3-C-2): the dashboard's real-time source of truth,
since CloudWatch metrics lag by about a minute. Runs continuously against
`http://<alb>/<prefix>/` (real or fake) at ~20 req/s, batching `TrafficSample`
rows into the store every ~250ms so the gate evaluator and a live chart both
see fresh data without waiting for a full observe window.

Thread-based rather than asyncio: start()/stop() need to work cleanly from
whatever thread calls them (the orchestrator's, a CLI's, a test's), and a
plain ThreadPoolExecutor gives the same concurrent-request behaviour with
none of asyncio's single-loop-per-thread bookkeeping.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from agents.common import store
from agents.common.models import ServedBy, TrafficSample

DEFAULT_RATE_PER_S = 20.0
BATCH_INTERVAL_S = 0.25
REQUEST_TIMEOUT_S = 3.0
MAX_WORKERS = 8


def _served_by(body: bytes) -> ServedBy:
    try:
        value = json.loads(body).get("served_by")
    except Exception:  # noqa: BLE001 - a non-JSON body is `unknown`, not a crash
        return ServedBy.UNKNOWN
    try:
        return ServedBy(value)
    except ValueError:
        return ServedBy.UNKNOWN


def _one_request(url: str) -> tuple[int, float, ServedBy]:
    start = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_S) as resp:
            body, status = resp.read(), resp.status
    except urllib.error.HTTPError as exc:
        body, status = exc.read(), exc.code
    except Exception:  # noqa: BLE001 - connection refused/timeout -> unknown, not a crash
        return 0, (time.monotonic() - start) * 1000, ServedBy.UNKNOWN
    return status, (time.monotonic() - start) * 1000, _served_by(body)


class TrafficGenerator:
    def __init__(
        self,
        app_id: str,
        base_url: str,
        path: str = "/",
        *,
        rate_per_s: float = DEFAULT_RATE_PER_S,
        run_id: str | None = None,
    ):
        self.app_id = app_id
        self.url = base_url.rstrip("/") + "/" + path.lstrip("/")
        self.rate_per_s = rate_per_s
        self.run_id = run_id
        self._stop = threading.Event()
        self._buffer: list[TrafficSample] = []
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

    def _record(self, status: int, latency_ms: float, served_by: ServedBy) -> None:
        sample = TrafficSample(
            ts=datetime.now(timezone.utc), app_id=self.app_id, status=status,
            latency_ms=latency_ms, served_by=served_by, run_id=self.run_id,
        )
        with self._lock:
            self._buffer.append(sample)

    def _flush(self) -> None:
        with self._lock:
            batch, self._buffer = self._buffer, []
        if batch:
            store.insert_traffic(batch)

    def _fire(self) -> None:
        status, latency_ms, served_by = _one_request(self.url)
        self._record(status, latency_ms, served_by)

    def _loop(self) -> None:
        interval = 1.0 / self.rate_per_s
        last_flush = time.monotonic()
        while not self._stop.is_set():
            self._executor.submit(self._fire)
            if time.monotonic() - last_flush >= BATCH_INTERVAL_S:
                self._flush()
                last_flush = time.monotonic()
            time.sleep(interval)
        self._flush()

    def start(self) -> "TrafficGenerator":
        self._thread = threading.Thread(target=self._loop, daemon=True, name=f"traffic-{self.app_id}")
        self._thread.start()
        return self

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=timeout)
        self._executor.shutdown(wait=True, cancel_futures=True)
        self._flush()

    def __enter__(self) -> "TrafficGenerator":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()
