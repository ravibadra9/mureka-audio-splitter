"""
deploy_to_github.py - One-Click Publisher for Mureka Audio Splitter
Commits all changes in C:\\Users\\admin\\Desktop\\tools\\extension and pushes to GitHub.
"""

import os
import subprocess
import json
from pathlib import Path

EXT_DIR = Path("C:/Users/admin/Desktop/tools/extension")
os.chdir(EXT_DIR)

def run_cmd(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if p.stdout.strip():
        print(p.stdout.strip())
    if p.returncode != 0 and p.stderr.strip():
        print("ERR:", p.stderr.strip())
    return p.returncode

print("=" * 60)
print("🚀  DEPLOYING MUREKA AUDIO SPLITTER TO GITHUB")
print("=" * 60)

run_cmd("git add .")
msg = input("Enter commit message (or press Enter for default): ").strip()
if not msg:
    msg = "update: Live OTA patch release for Mureka Audio Splitter"

run_cmd(f'git commit -m "{msg}"')
ret = run_cmd("git push origin main")

if ret == 0:
    print("\n🎉 Successfully pushed update to: https://github.com/ravibadra9/mureka-audio-splitter")
    print("All users can now click '⚡ Update OTA' in their extension to get this update!")
else:
    print("\n⚠️ Push encountered an issue. See output above.")
