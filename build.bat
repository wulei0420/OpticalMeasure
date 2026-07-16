@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

echo.
echo === Building capture_three.exe ===
cl /EHsc /O2 /MT /Fe:capture_three.exe capture_three.cpp strmiids.lib mf.lib mfplat.lib mfuuid.lib ole32.lib oleaut32.lib shlwapi.lib windowscodecs.lib /link /SUBSYSTEM:CONSOLE
if %ERRORLEVEL% NEQ 0 goto :fail

echo.
echo === Building stereo_calibrate.exe ===
set OCV=opencv_sdk
cl /EHsc /O2 /MT /Fe:stereo_calibrate.exe stereo_calibrate.cpp /I%OCV%\include /link /LIBPATH:%OCV%\lib opencv_world4100.lib /SUBSYSTEM:CONSOLE
if %ERRORLEVEL% NEQ 0 goto :fail

copy %OCV%\bin\opencv_world4100.dll . >nul 2>&1

echo.
echo === Build SUCCESS ===
goto :end

:fail
echo.
echo === Build FAILED ===

:end
