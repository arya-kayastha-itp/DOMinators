#!/usr/bin/env python3
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_ID = os.environ.get("APP_ID", "app-unknown")
SERVED_BY = os.environ.get("SERVED_BY", "unknown")
PORT = int(os.environ.get("PORT", "8080"))
UPSTREAM_URL = os.environ.get("UPSTREAM_URL", "")
PATH_PREFIX = os.environ.get("PATH_PREFIX", "")


def call_upstream():
    if not UPSTREAM_URL:
        return None
    try:
        with urllib.request.urlopen(UPSTREAM_URL, timeout=2) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        return {"error": str(exc)}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = self.path.rstrip("/") or "/"
        prefixed_health = f"{PATH_PREFIX}/health".rstrip("/")
        prefixed_root = PATH_PREFIX.rstrip("/") or "/"

        if path in ("/health", prefixed_health):
            self._send_json(200, {"status": "ok"})
            return

        if path in ("/", prefixed_root):
            if os.environ.get("REQUIRE_UPSTREAM") == "1" and not UPSTREAM_URL:
                self._send_json(500, {"app": APP_ID, "served_by": SERVED_BY, "error": "missing upstream config"})
                return
            body = {
                "app": APP_ID,
                "served_by": SERVED_BY,
                "version": "1.0",
            }
            if UPSTREAM_URL:
                body["upstream"] = call_upstream()
            self._send_json(200, body)
            return

        self._send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
