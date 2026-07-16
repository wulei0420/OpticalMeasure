@echo off
title OpticalMeasure - Install Auto-Start
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%~dp0start_silent.vbs"

if not exist "%VBS%" (
    echo ERROR: start_silent.vbs not found.
    pause
    exit /b 1
)

echo Creating auto-start shortcut...
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%STARTUP%\OpticalMeasure.lnk'); $Shortcut.TargetPath = '%VBS%'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.Save()"
echo Done. OpticalMeasure will start on login.
pause
