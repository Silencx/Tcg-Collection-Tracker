@echo off
REM Serve the site locally on http://localhost:8000.
REM REQUIRED: ES modules refuse to load over file:// - you must serve over http.
cd /d "%~dp0"
echo Serving Pokemon Master Set on http://localhost:8000  (Ctrl+C to stop)
python -m http.server 8000
