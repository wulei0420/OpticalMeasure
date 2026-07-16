@echo off
echo ============================================
echo  OpticalMeasure V2.30 - Starting...
echo ============================================
echo.
echo   Main app:     http://localhost:5002
echo   Calibration:  http://localhost:5003
echo.
echo Close this window to stop both servers.
echo ============================================

cd /d "%~dp0"

start "OM-5002" /min python main.py
start "OM-5003" /min python calib.py

timeout /t 3 /nobreak >nul
start http://localhost:5002

echo Both servers running. Press any key to stop...
pause >nul

taskkill /f /im python.exe /fi "WINDOWTITLE eq OM-5002" >nul 2>&1
taskkill /f /im python.exe /fi "WINDOWTITLE eq OM-5003" >nul 2>&1
