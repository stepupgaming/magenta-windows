@echo off
setlocal
set "PYTHONPATH=%~dp0engine"
"%~dp0engine\.venv\Scripts\python.exe" -m magenta_win.cli %*
