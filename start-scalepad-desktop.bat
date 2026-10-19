@echo off
rem Double-click to run ScalePad on this Windows PC (http://127.0.0.1:47815/, works offline)
chcp 65001 >nul
cd /d "%~dp0"
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY ( python -c "import sys" >nul 2>nul && set "PY=python" )
if not defined PY goto nopython
%PY% -c "import openpyxl" >nul 2>nul || echo Note: openpyxl is missing, so one-click merge into the summary xlsx is off. Install with: %PY% -m pip install openpyxl
echo Keep this window open during testing. Close it to stop ScalePad.
%PY% serve_local.py
if errorlevel 1 pause
goto :eof

:nopython
echo Python 3 was not found. Opening ScalePad directly in the browser instead.
echo (Everything works except one-click merge into the summary xlsx.)
echo For the full version install Python from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
start "" "%~dp0index.html"
pause
