@echo off
title Mureka Audio Splitter - Companion Bridge
cd /d "%~dp0"
echo =========================================================
echo    Mureka Audio Splitter - Local Companion Bridge
echo =========================================================
echo Starting local helper server on http://127.0.0.1:59955 ...
python bridge.py
pause
