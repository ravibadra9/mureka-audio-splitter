@echo off
title Mureka Audio Splitter - OTA Updater
cd /d "%~dp0"
echo =========================================================
echo    Mureka Audio Splitter - Live GitHub OTA Updater
echo =========================================================
echo Checking and pulling latest updates from GitHub...
git pull origin main
echo.
echo =========================================================
echo   SUCCESS: Extension updated to latest GitHub version!
echo   Tip: In Chrome, go to chrome://extensions/ and click 
echo   the Reload (refresh) icon to apply immediately.
echo =========================================================
pause
