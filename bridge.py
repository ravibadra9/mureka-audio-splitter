"""
Mureka Audio Splitter - Local Companion Bridge
Allows Chrome Extension to leverage local yt-dlp & FFmpeg for ultra-fast downloads and hardware-accelerated audio splitting.
Runs on http://127.0.0.1:59955
"""

import sys
import os
import json
import time
import subprocess
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

PORT = 59955
DOWNLOAD_DIR = Path.home() / "Desktop" / "AudioSegments"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Netscape cookie writer
def prepare_netscape_file(cookie_data: str) -> str | None:
    if not cookie_data or not cookie_data.strip():
        return None
    cookie_data = cookie_data.strip()
    target_path = Path.home() / "AppData" / "Local" / "StoriesStudio" / "mureka_yt_cookies.txt"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(cookie_data)
        return str(target_path)
    except Exception as e:
        print(f"Error saving cookie file: {e}")
        return None

class BridgeHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            res = {
                "status": "online",
                "companion": "Mureka Audio Splitter Companion Bridge",
                "version": "1.0.0",
                "download_dir": str(DOWNLOAD_DIR)
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif path == "/file":
            qs = urllib.parse.parse_qs(parsed.query)
            target_path = qs.get("path", [""])[0]
            if not target_path or not os.path.isfile(target_path):
                self.send_response(404)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b"File not found")
                return

            try:
                with open(target_path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(data)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(data)
                return
            except Exception as e:
                self.send_response(500)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
                return

        elif path == "/ota_update":
            try:
                ext_dir = Path(__file__).parent.resolve()
                res = subprocess.run(["git", "pull", "origin", "main"], cwd=str(ext_dir), capture_output=True, text=True, timeout=30)
                v_file = ext_dir / "version.json"
                v_data = {}
                if v_file.exists():
                    try:
                        with open(v_file, "r", encoding="utf-8") as vf:
                            v_data = json.load(vf)
                    except Exception:
                        pass
                self._send_json({
                    "success": True,
                    "version": v_data.get("version", "1.0.1"),
                    "output": res.stdout.strip(),
                    "message": "OTA Update applied successfully from GitHub!"
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/ota_update":
            self.do_GET()
            return

        if path == "/download":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body) if body else {}

            url = data.get("url", "").strip()
            cookies_text = data.get("cookies", "").strip()

            if not url:
                self._send_json({"success": False, "error": "No URL provided"}, 400)
                return

            try:
                import yt_dlp
                cookie_file = prepare_netscape_file(cookies_text)
                out_tmpl = str(DOWNLOAD_DIR / "%(title)s.%(ext)s")

                ydl_opts = {
                    "format": "ba[ext=m4a]/ba/b",
                    "outtmpl": out_tmpl,
                    "noplaylist": True,
                    "nocheckcertificate": True,
                    "extractor_args": {"youtube": {"player_client": ["web_embedded", "android"]}},
                    "postprocessors": [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "0",
                    }],
                    "quiet": True,
                    "no_warnings": True,
                }
                FFMPEG_DIR = r"C:\ffmpeg\ffmpeg-8.1.2-essentials_build\bin"
                if os.path.isdir(FFMPEG_DIR):
                    ydl_opts["ffmpeg_location"] = FFMPEG_DIR

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    title = info.get("title", "Audio")
                    dur = info.get("duration", 0)

                # Locate downloaded audio file (mp3, m4a, mp4, etc.)
                audio_files = []
                for ext_pat in ["*.mp3", "*.m4a", "*.mp4", "*.webm", "*.opus", "*.wav"]:
                    audio_files.extend(DOWNLOAD_DIR.glob(ext_pat))
                audio_files = [f for f in audio_files if f.stat().st_size > 1024]
                audio_files.sort(key=os.path.getmtime, reverse=True)

                if not audio_files:
                    raise RuntimeError("Could not find downloaded audio file.")

                latest_audio = str(audio_files[0])
                m, s = divmod(int(dur), 60)
                dur_str = f"{m}:{s:02d}"

                self._send_json({
                    "success": True,
                    "title": title,
                    "duration": dur,
                    "duration_str": dur_str,
                    "filepath": latest_audio
                })

            except Exception as e:
                print(f"Bridge Download Exception: {e}")
                self._send_json({"success": False, "error": str(e)}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def _send_json(self, data: dict, status_code: int = 200):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

def run():
    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, BridgeHandler)
    print("=" * 65)
    print("[MUREKA AUDIO SPLITTER] - COMPANION BRIDGE ACTIVE")
    print(f">> Listening on: http://127.0.0.1:{PORT}")
    print(f">> Downloads Folder: {DOWNLOAD_DIR}")
    print(">> Connected to Chrome Extension for high-speed processing")
    print("=" * 65)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Mureka Companion Bridge.")
        httpd.server_close()

if __name__ == "__main__":
    run()
