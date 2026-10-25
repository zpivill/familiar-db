"""Local editor server: serves the site and saves pasted pictures and roster edits.

Run:  py serve.py   then open http://localhost:8000
"""
import http.server
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
IMAGE = re.compile(r"/api/images/([a-z0-9-]+\.(?:png|jpg|webp|gif))")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_PUT(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/api/characters":
            json.loads(body)  # refuse to save broken JSON
            path = os.path.join(ROOT, "data", "characters.json")
        elif m := IMAGE.fullmatch(self.path):
            path = os.path.join(ROOT, "images", m[1])
        else:
            return self.send_error(404)
        with open(path, "wb") as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "images"), exist_ok=True)
    print("Familiar DB editor running at http://localhost:8000  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
