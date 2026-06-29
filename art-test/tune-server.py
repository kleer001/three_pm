#!/usr/bin/env python3
"""Serve the repo for the tentacle art-test sandboxes and accept their Save buttons.

Plain `http.server` can't take a POST, and a browser can't write to /tmp on its own,
so this thin wrapper serves the repo root (so the ES modules load) and writes any
POST /save/<name> body to /tmp/<name>.json for the session to read back.
(`/save-tuning` is kept as an alias for /tmp/tentacle-tuning.json.)

    PORT=8137 python3 art-test/tune-server.py
"""
import http.server
import os
import re
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "8137"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always refetch edited ES modules
        super().end_headers()

    def do_POST(self):
        if self.path == "/save-tuning":
            name = "tentacle-tuning"
        else:
            m = re.fullmatch(r"/save/([\w-]+)", self.path)  # safe basename only
            name = m.group(1) if m else None
        if not name:
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with open(f"/tmp/{name}.json", "wb") as f:
            f.write(body)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


with Server(("127.0.0.1", PORT), Handler) as srv:
    print(f"serving {ROOT} on http://127.0.0.1:{PORT}  (POST /save/<name> -> /tmp/<name>.json)")
    srv.serve_forever()

