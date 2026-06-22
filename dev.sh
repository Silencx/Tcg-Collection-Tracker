#!/usr/bin/env bash
# Serve the site locally on http://localhost:8000.
# REQUIRED: ES modules refuse to load over file:// — you must serve over http.
cd "$(dirname "$0")"
echo "Serving Pokemon Master Set on http://localhost:8000  (Ctrl+C to stop)"
python3 -m http.server 8000
