@echo off
rem Double-click to render the same prompt with the v0.1.1 engine and today's, so you
rem can hear whether the engine changes made it sound worse. Close the Magenta window
rem first. It takes about 9 minutes. Results go to engine\logs\ab-check.
rem Pass --prompt "deep house" --drums or --seeds 1 2 to change what it renders.
setlocal
cd /d "%~dp0"
set "PY=%~dp0engine\.venv\Scripts\python.exe"
if not exist "%PY%" echo The engine's Python is missing: "%PY%"
if not exist "%PY%" echo Run uv sync in the engine folder, or open the app once with pnpm dev, then try again.
if exist "%PY%" "%PY%" "%~dp0scripts\ab_check.py" %*
echo.
pause
