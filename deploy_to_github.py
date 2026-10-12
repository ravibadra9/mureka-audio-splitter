"""
deploy_to_github.py - One-Click Publisher for Mureka Audio Splitter
Commits all changes in C:\\Users\\admin\\Desktop\\tools\\extension and pushes to GitHub.
"""

import sys
import os
import subprocess
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

EXT_DIR = Path("C:/Users/admin/Desktop/tools/extension")
os.chdir(EXT_DIR)

def run_cmd(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.stdout.strip():
        print(p.stdout.strip())
    if p.returncode != 0 and p.stderr.strip():
        print("ERR:", p.stderr.strip())
    return p.returncode

print("=" * 60)
print("[Deploy] Deploying Mureka Audio Splitter to GitHub...")
print("=" * 60)

run_cmd("git add .")
msg = sys.argv[1] if len(sys.argv) > 1 else "v1.0.2: Persistent Window & Side Panel modes, auto-save state, optional FFmpeg native fallback"
run_cmd(f'git commit -m "{msg}"')
ret = run_cmd("git push origin main")

if ret == 0:
    print("\n[SUCCESS] Successfully pushed update to: https://github.com/ravibadra9/mureka-audio-splitter")
    print("All users can now click '⚡ Update OTA' in their extension to get this update!")
else:
    print("\n[WARNING] Push encountered an issue. See output above.")
