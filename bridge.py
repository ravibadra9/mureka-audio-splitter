"""
Mureka Audio Splitter - Local Companion Bridge
Allows Chrome Extension to leverage local yt-dlp & FFmpeg for ultra-fast downloads and hardware-accelerated audio splitting.
Runs on http://127.0.0.1:59955
"""

import sys
import os
import json
import time
import shutil
import subprocess
import mimetypes
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

# Force UTF-8 on Windows stdout/stderr
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

PORT = 59955
DOWNLOAD_DIR = Path.home() / "Desktop" / "AudioSegments"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Cache for the last downloaded audio session
LAST_DOWNLOAD = None

def find_ffmpeg_location() -> str | None:
    """
    Auto-detects FFmpeg binary location on the system.
    Returns directory path containing ffmpeg.exe if found, else None.
    If None is returned, yt-dlp downloads native audio stream (m4a/opus) without needing FFmpeg!
    """
    # 1. Check system PATH
    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return os.path.dirname(os.path.abspath(sys_ffmpeg))

    # 2. Check candidate directories
    script_dir = Path(__file__).parent.resolve()
    candidates = [
        script_dir / "ffmpeg.exe",
        script_dir.parent / "ffmpeg.exe",
        Path(r"C:\ffmpeg\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe"),
        Path(r"C:\ffmpeg\bin\ffmpeg.exe"),
        Path(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"),
    ]
    for cand in candidates:
        if cand.is_file():
            return str(cand.parent)

    # 3. Check Python imageio_ffmpeg if installed
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return os.path.dirname(os.path.abspath(exe))
    except Exception:
        pass

    return None

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
        global LAST_DOWNLOAD
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            ffmpeg_dir = find_ffmpeg_location()
            res = {
                "status": "online",
                "companion": "Mureka Audio Splitter Companion Bridge",
                "version": "1.0.2",
                "ffmpeg_available": bool(ffmpeg_dir),
                "ffmpeg_dir": ffmpeg_dir or "Not installed (Using Native Audio Stream Mode)",
                "download_dir": str(DOWNLOAD_DIR),
                "has_last_download": bool(LAST_DOWNLOAD)
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif path == "/last_download":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            if LAST_DOWNLOAD and os.path.isfile(LAST_DOWNLOAD.get("filepath", "")):
                res = {"available": True, **LAST_DOWNLOAD}
            else:
                res = {"available": False}
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
                mime_type, _ = mimetypes.guess_type(target_path)
                if not mime_type:
                    mime_type = "audio/mpeg" if target_path.endswith(".mp3") else "audio/mp4"

                with open(target_path, "rb") as f:
                    data = f.read()

                self.send_response(200)
                self.send_header("Content-Type", mime_type)
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
                    "version": v_data.get("version", "1.0.2"),
                    "output": res.stdout.strip(),
                    "message": "OTA Update applied successfully from GitHub!"
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        global LAST_DOWNLOAD
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
                    "quiet": True,
                    "no_warnings": True,
                }

                if cookie_file and os.path.isfile(cookie_file):
                    ydl_opts["cookiefile"] = cookie_file

                # FFmpeg Handling:
                # If FFmpeg is on PC: convert to 320k MP3
                # If FFmpeg is NOT on PC: download raw stream (m4a/opus/webm) directly without error!
                # Chrome extension decodes m4a/webm/opus natively via Web Audio API.
                ffmpeg_loc = find_ffmpeg_location()
                if ffmpeg_loc:
                    ydl_opts["ffmpeg_location"] = ffmpeg_loc
                    ydl_opts["postprocessors"] = [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "0",
                    }]
                    print(f"[Bridge] Using FFmpeg from: {ffmpeg_loc} (MP3 320k conversion active)")
                else:
                    print("[Bridge] FFmpeg not found on PC - downloading native audio stream (m4a/opus) directly.")

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    title = info.get("title", "Audio")
                    dur = info.get("duration", 0)

                # Locate downloaded audio file (mp3, m4a, mp4, webm, opus, etc.)
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

                LAST_DOWNLOAD = {
                    "title": title,
                    "duration": dur,
                    "duration_str": dur_str,
                    "filepath": latest_audio,
                    "timestamp": time.time(),
                    "size_mb": round(os.path.getsize(latest_audio) / (1024 * 1024), 2),
                    "ext": Path(latest_audio).suffix.replace(".", "").lower()
                }

                self._send_json({
                    "success": True,
                    "title": title,
                    "duration": dur,
                    "duration_str": dur_str,
                    "filepath": latest_audio,
                    "ext": LAST_DOWNLOAD["ext"],
                    "ffmpeg_used": bool(ffmpeg_loc)
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

    def log_message(self, format, *args):
        # Clean console log without clutter
        pass

def start_server():
    server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
    print("=" * 60)
    print(f" MUREKA COMPANION BRIDGE ACTIVE on http://127.0.0.1:{PORT}")
    ffmpeg_loc = find_ffmpeg_location()
    if ffmpeg_loc:
        print(f" FFmpeg Status: Detected ({ffmpeg_loc})")
    else:
        print(" FFmpeg Status: Not on PC -> Native Stream Mode Active (Zero dependency)")
    print(f" Download Directory: {DOWNLOAD_DIR}")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down bridge server...")
        server.server_close()

if __name__ == "__main__":
    start_server()
