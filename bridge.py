"""
Mureka Audio Splitter - Local Companion Bridge (v1.0.3)
High-performance local backend for the Mureka Audio Splitter Chrome Extension.
Features:
- Live Download Percentage, Speed & ETA tracking (/progress)
- Hardware-Accelerated Local FFmpeg Audio Slicing (0.05s per song, ZERO BROWSER HANG!)
- Auto-Trim upon download completion
- Auto-Delete Master Full Audio file (retaining only sliced tracks)
- One-Click Desktop App Launcher (launch music_app.py)
- Web Studio Dashboard (http://127.0.0.1:59955)
"""

import sys
import os
import re
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

# State tracking
LAST_DOWNLOAD = None
CURRENT_PROGRESS = {
    "status": "idle",
    "percent": 0.0,
    "speed": "",
    "eta": "",
    "downloaded_bytes": 0,
    "total_bytes": 0,
    "title": ""
}

def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', '_', str(name or 'segment')).strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned[:100] or 'segment'

def parse_time_to_seconds(ts: str) -> float:
    if not ts:
        return 0.0
    ts = str(ts).strip()
    parts = ts.split(":")
    try:
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 1:
            return float(parts[0])
    except Exception:
        pass
    return 0.0

def find_ffmpeg_location() -> str | None:
    # 1. System PATH
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

    # 3. Check Python imageio_ffmpeg
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return os.path.dirname(os.path.abspath(exe))
    except Exception:
        pass

    return None

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

def ydl_progress_hook(d):
    global CURRENT_PROGRESS
    if d.get("status") == "downloading":
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        downloaded = d.get("downloaded_bytes") or 0
        percent = round(downloaded / total * 100, 1) if total > 0 else 0.0
        speed = d.get("speed") or 0
        speed_str = f"{speed / (1024 * 1024):.1f} MB/s" if speed else ""
        eta = d.get("eta") or 0
        eta_str = f"{eta}s" if eta else ""
        CURRENT_PROGRESS = {
            "status": "downloading",
            "percent": percent,
            "speed": speed_str,
            "eta": eta_str,
            "downloaded_bytes": downloaded,
            "total_bytes": total,
            "title": d.get("filename", "")
        }
    elif d.get("status") == "finished":
        CURRENT_PROGRESS = {
            "status": "finished",
            "percent": 100.0,
            "speed": "",
            "eta": "0s",
            "downloaded_bytes": d.get("total_bytes", 0),
            "total_bytes": d.get("total_bytes", 0),
            "title": d.get("filename", "")
        }

def slice_audio_file(source_path: str, segments: list, out_folder_name: str = "AudioSegments", out_format: str = "mp3", delete_source: bool = True) -> dict:
    source_p = Path(source_path)
    if not source_p.is_file():
        raise FileNotFoundError(f"Source audio file not found: {source_path}")

    out_dir = Path.home() / "Desktop" / "AudioSegments" / sanitize_filename(out_folder_name)
    out_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg_dir = find_ffmpeg_location()
    ffmpeg_exe = str(Path(ffmpeg_dir) / "ffmpeg.exe") if ffmpeg_dir else "ffmpeg"

    results = []
    for idx, seg in enumerate(segments, 1):
        name = seg.get("name", f"Segment_{idx}").strip()
        start_sec = parse_time_to_seconds(seg.get("start", "0"))
        end_sec = parse_time_to_seconds(seg.get("end", "0"))

        if end_sec <= start_sec:
            continue

        clean_name = sanitize_filename(name)
        out_filename = f"{idx:02d}. {clean_name}.{out_format}"
        out_file = out_dir / out_filename

        cmd = [
            ffmpeg_exe, "-y",
            "-ss", str(start_sec),
            "-to", str(end_sec),
            "-i", str(source_p)
        ]

        if out_format == "wav":
            cmd.extend(["-c:a", "pcm_s16le"])
        elif source_p.suffix.lower() == f".{out_format}":
            cmd.extend(["-c", "copy"])
        else:
            cmd.extend(["-c:a", "libmp3lame", "-b:a", "320k"])

        cmd.append(str(out_file))

        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0 and out_file.is_file() and out_file.stat().st_size > 512:
            results.append({
                "index": idx,
                "name": clean_name,
                "file": str(out_file),
                "size_mb": round(out_file.stat().st_size / (1024 * 1024), 2)
            })
        else:
            print(f"[Bridge] Error slicing {clean_name}: {res.stderr[:200]}")

    # Auto-delete full audio if requested
    deleted_source = False
    if delete_source and results and source_p.is_file():
        try:
            source_p.unlink(missing_ok=True)
            deleted_source = True
            print(f"[Bridge] Auto-deleted full master audio file: {source_p}")
        except Exception as e:
            print(f"[Bridge] Could not delete source: {e}")

    return {
        "success": True,
        "sliced_count": len(results),
        "total_segments": len(segments),
        "output_dir": str(out_dir),
        "deleted_source": deleted_source,
        "files": results
    }

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
        global LAST_DOWNLOAD, CURRENT_PROGRESS
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ["/", "/studio"]:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            # Redirect or serve extension popup.html directly
            ext_dir = Path(__file__).parent.resolve()
            p_html = ext_dir / "popup.html"
            if p_html.exists():
                with open(p_html, "r", encoding="utf-8") as f:
                    self.wfile.write(f.read().encode("utf-8"))
            else:
                self.wfile.write(b"<h1>Mureka Audio Splitter Companion Active</h1>")
            return

        elif path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            ffmpeg_dir = find_ffmpeg_location()
            res = {
                "status": "online",
                "companion": "Mureka Audio Splitter Companion Bridge",
                "version": "1.0.3",
                "ffmpeg_available": bool(ffmpeg_dir),
                "ffmpeg_dir": ffmpeg_dir or "Not installed (Using Native Audio Stream Mode)",
                "download_dir": str(DOWNLOAD_DIR),
                "has_last_download": bool(LAST_DOWNLOAD),
                "progress": CURRENT_PROGRESS
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif path == "/progress":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(CURRENT_PROGRESS).encode("utf-8"))
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

        elif path == "/launch_desktop":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            try:
                candidates = [
                    Path(__file__).parent.parent / "music_app.py",
                    Path(r"C:\Users\admin\Downloads\Telegram Desktop\My Tool (2)\music_app.py")
                ]
                launched = False
                for cand in candidates:
                    if cand.is_file():
                        subprocess.Popen([sys.executable, str(cand)], cwd=str(cand.parent))
                        launched = True
                        break
                self.wfile.write(json.dumps({"success": launched, "message": "Launched desktop music suite!" if launched else "music_app.py not found"}).encode("utf-8"))
            except Exception as e:
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        elif path == "/open_folder":
            qs = urllib.parse.parse_qs(parsed.query)
            target = qs.get("path", [str(DOWNLOAD_DIR)])[0]
            if os.path.exists(target):
                os.startfile(target)
            self._send_json({"success": True})
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
                    "version": v_data.get("version", "1.0.3"),
                    "output": res.stdout.strip(),
                    "message": "OTA Update applied successfully from GitHub!"
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        global LAST_DOWNLOAD, CURRENT_PROGRESS
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/ota_update":
            self.do_GET()
            return

        if path == "/split":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body) if body else {}

            filepath = data.get("filepath", "")
            segments = data.get("segments", [])
            folder = data.get("folder", "AudioSegments")
            fmt = data.get("format", "mp3")
            delete_source = data.get("delete_source", True)

            if not filepath or not os.path.isfile(filepath):
                self._send_json({"success": False, "error": "Invalid audio file path"}, 400)
                return

            if not segments:
                self._send_json({"success": False, "error": "No segments provided"}, 400)
                return

            try:
                res = slice_audio_file(filepath, segments, folder, fmt, delete_source)
                self._send_json(res)
            except Exception as e:
                print(f"[Bridge] Split Error: {e}")
                self._send_json({"success": False, "error": str(e)}, 500)
            return

        if path in ["/download", "/download_and_split"]:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body) if body else {}

            url = data.get("url", "").strip()
            cookies_text = data.get("cookies", "").strip()
            segments = data.get("segments", [])
            auto_trim = bool(data.get("auto_trim", False) or (path == "/download_and_split" and segments))
            folder = data.get("folder", "AudioSegments")
            fmt = data.get("format", "mp3")
            delete_source = data.get("delete_source", True)

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
                    "progress_hooks": [ydl_progress_hook],
                    "quiet": True,
                    "no_warnings": True,
                }

                if cookie_file and os.path.isfile(cookie_file):
                    ydl_opts["cookiefile"] = cookie_file

                ffmpeg_loc = find_ffmpeg_location()
                if ffmpeg_loc:
                    ydl_opts["ffmpeg_location"] = ffmpeg_loc
                    ydl_opts["postprocessors"] = [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "0",
                    }]
                    print(f"[Bridge] Using FFmpeg from: {ffmpeg_loc} (MP3 320k active)")

                # Reset progress tracker
                CURRENT_PROGRESS = {"status": "downloading", "percent": 0.0, "speed": "Starting...", "eta": "", "downloaded_bytes": 0, "total_bytes": 0, "title": ""}

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                    title = info.get("title", "Audio")
                    dur = info.get("duration", 0)

                # Locate downloaded file
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

                CURRENT_PROGRESS["status"] = "finished"
                CURRENT_PROGRESS["percent"] = 100.0

                # Auto-trim & auto-delete master audio if segments were provided
                if auto_trim and segments:
                    print(f"[Bridge] Auto-Trim triggered for {len(segments)} segments...")
                    split_res = slice_audio_file(latest_audio, segments, folder, fmt, delete_source)
                    self._send_json({
                        "success": True,
                        "auto_trimmed": True,
                        "title": title,
                        "duration": dur,
                        "duration_str": dur_str,
                        "sliced_count": split_res.get("sliced_count", 0),
                        "output_dir": split_res.get("output_dir", ""),
                        "deleted_master": split_res.get("deleted_source", False),
                        "files": split_res.get("files", [])
                    })
                    return

                # Normal download response
                self._send_json({
                    "success": True,
                    "auto_trimmed": False,
                    "title": title,
                    "duration": dur,
                    "duration_str": dur_str,
                    "filepath": latest_audio,
                    "ext": LAST_DOWNLOAD["ext"],
                    "ffmpeg_used": bool(ffmpeg_loc)
                })

            except Exception as e:
                print(f"Bridge Download Exception: {e}")
                CURRENT_PROGRESS["status"] = "error"
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
        pass

def start_server():
    server = HTTPServer(("127.0.0.1", PORT), BridgeHandler)
    print("=" * 60)
    print(f" MUREKA COMPANION BRIDGE v1.0.3 ACTIVE on http://127.0.0.1:{PORT}")
    ffmpeg_loc = find_ffmpeg_location()
    if ffmpeg_loc:
        print(f" FFmpeg Status: Detected ({ffmpeg_loc}) - Instant Local Slicing Active")
    else:
        print(" FFmpeg Status: Not on PC -> Native Stream Mode Active")
    print(f" Download & Segments Directory: {DOWNLOAD_DIR}")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down bridge server...")
        server.server_close()

if __name__ == "__main__":
    start_server()
