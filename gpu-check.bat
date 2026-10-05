@echo off
rem Double-click to check Magenta on this NVIDIA GPU: the speed of magenta generate,
rem continuing from a clip, and a 10-minute live stream with constant steering while
rem GPU memory is watched. Close the Magenta window first. It takes about 15 minutes.
rem Results go to engine\logs\gpu-check. Pass --minutes 3 for a shorter live test.
setlocal
cd /d "%~dp0"
set "PY=%~dp0engine\.venv\Scripts\python.exe"
if not exist "%PY%" echo The engine's Python is missing: "%PY%"
if not exist "%PY%" echo Run uv sync in the engine folder, or open the app once with pnpm dev, then try again.
if exist "%PY%" "%PY%" "%~dp0scripts\gpu_check.py" %*
echo.
pause
