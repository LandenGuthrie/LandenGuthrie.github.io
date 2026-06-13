@echo off
cd /d "%~dp0"
echo Starting Landens Portfolio at http://localhost:8000
start "" http://localhost:8000
python -m http.server 8000 2>nul || py -m http.server 8000
pause
