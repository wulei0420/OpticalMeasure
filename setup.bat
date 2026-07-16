@echo off
setlocal enabledelayedexpansion
title OpticalMeasure V2.30 - Setup

echo ============================================
echo   OpticalMeasure V2.30 - First-Time Setup
echo ============================================
echo.
cd /d "%~dp0"

:: Python detection
echo [1/5] Checking Python...
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ERROR: Python not found in PATH.
    echo   Please install Python 3.8+ (64-bit) from https://www.python.org/
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo   Found Python !PYVER!

for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
    set MAJOR=%%a
    set MINOR=%%b
)
if !MAJOR! LSS 3 (
    echo   ERROR: Python 3.8+ required, found !PYVER!
    pause
    exit /b 1
)
if !MAJOR! EQU 3 if !MINOR! LSS 8 (
    echo   ERROR: Python 3.8+ required, found !PYVER!
    pause
    exit /b 1
)

python -c "import struct; exit(0 if struct.calcsize('P')==8 else 1)" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   WARNING: 32-bit Python detected. 64-bit recommended.
)

:: Install dependencies
echo.
echo [2/5] Installing Python packages...
pip install flask opencv-python numpy --quiet 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ERROR: pip install failed. Check internet connection.
    pause
    exit /b 1
)
echo   Packages installed OK.

:: Verify files
echo.
echo [3/5] Verifying installation files...
if not exist "opencv_world4100.dll" (
    echo   WARNING: opencv_world4100.dll not found.
)
if not exist "capture_three.exe" (
    echo   WARNING: capture_three.exe not found.
)
if not exist "stereo_calibrate.exe" (
    echo   WARNING: stereo_calibrate.exe not found.
)

:: Create directories
echo.
echo [4/5] Creating directories...
if not exist "calib_frames" mkdir calib_frames
if not exist "customers" mkdir customers
if not exist "feedback" mkdir feedback
echo   Directories ready.

:: Copy default configs
echo.
echo [5/5] Setting up configuration...
if not exist "camera_config.json" (
    if exist "defaults\camera_config.json" (
        copy "defaults\camera_config.json" "camera_config.json" >nul
        echo   Created camera_config.json from template.
    ) else (
        echo {"left":2,"center":0,"right":1} > camera_config.json
        echo   Created default camera_config.json.
    )
) else (
    echo   camera_config.json already exists - preserved.
)
if not exist "user_config.json" (
    if exist "defaults\user_config.json" (
        copy "defaults\user_config.json" "user_config.json" >nul
        echo   Created user_config.json from template.
    ) else (
        echo {"pd_correction":1.0} > user_config.json
        echo   Created default user_config.json.
    )
) else (
    echo   user_config.json already exists - preserved.
)

echo.
echo ============================================
echo   Setup complete!
echo   To start:  double-click start_silent.vbs
echo   To stop:   double-click stop.bat
echo ============================================
timeout /t 3 /nobreak >nul
