@echo off
title OpticalMeasure - Remove Auto-Start
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\OpticalMeasure.lnk" (
    del "%STARTUP%\OpticalMeasure.lnk" 2>nul
    echo Auto-start shortcut removed.
) else (
    echo No auto-start shortcut found.
)
pause
