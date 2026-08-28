@echo off
setlocal
cd /d "%~dp0"

if not exist "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  echo [ERROR] Microsoft C++ Build Tools were not found.
  exit /b 1
)

if not exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
  echo [ERROR] Rust was not found.
  exit /b 1
)

call "C:\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
taskkill /F /IM FloralNotepaper.exe >nul 2>nul
call "C:\Program Files\nodejs\npm.cmd" run tauri build -- --no-bundle
if errorlevel 1 exit /b %errorlevel%

copy /y "src-tauri\target\release\floral-notepaper.exe" "..\FloralNotepaper.exe" >nul
if errorlevel 1 (
  echo [ERROR] The release was built, but FloralNotepaper.exe could not be updated.
  exit /b 1
)

echo [OK] Updated ..\FloralNotepaper.exe
exit /b 0
