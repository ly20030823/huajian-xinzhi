@echo off
setlocal
cd /d "%~dp0"

if not exist "package.json" (
  echo [ERROR] package.json was not found in "%CD%".
  pause
  exit /b 1
)

tasklist /FI "IMAGENAME eq floral-notepaper.exe" 2>nul | find /I "floral-notepaper.exe" >nul
if not errorlevel 1 (
  start "" "%~dp0src-tauri\target\debug\floral-notepaper.exe"
  exit /b 0
)

if not exist "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  echo [ERROR] Microsoft C++ Build Tools were not found.
  pause
  exit /b 1
)

if not exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
  echo [ERROR] Rust was not found.
  pause
  exit /b 1
)

call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
call "C:\Program Files\nodejs\npm.cmd" run tauri dev
if errorlevel 1 pause
endlocal
