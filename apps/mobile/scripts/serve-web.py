"""Serve the Expo web export with its extensionless route URLs."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parents[1] / "dist"


class ExpoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def translate_path(self, path):
        resolved = super().translate_path(path)
        if Path(resolved + ".html").is_file():
            return resolved + ".html"
        return resolved


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8081), ExpoHandler).serve_forever()
