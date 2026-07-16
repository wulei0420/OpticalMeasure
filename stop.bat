@echo off
title OpticalMeasure V2.30 - Stopping
cd /d "%~dp0"

echo Stopping OpticalMeasure V2.30 servers...

if exist pid_5002.txt (
    for /f %%i in (pid_5002.txt) do (
        echo Killing PID %%i (5002)
        taskkill /pid %%i /f 2>nul
    )
    del pid_5002.txt 2>nul
)
if exist pid_5003.txt (
    for /f %%i in (pid_5003.txt) do (
        echo Killing PID %%i (5003)
        taskkill /pid %%i /f 2>nul
    )
    del pid_5003.txt 2>nul
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5002 " ^| findstr "LISTENING" 2^>nul') do (
    echo Killing PID %%a (port 5002)
    taskkill /pid %%a /f 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5003 " ^| findstr "LISTENING" 2^>nul') do (
    echo Killing PID %%a (port 5003)
    taskkill /pid %%a /f 2>nul
)

echo Done.
timeout /t 2 /nobreak >nul
