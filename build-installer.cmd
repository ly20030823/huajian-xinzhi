@echo off
setlocal EnableExtensions
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

for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content package.json | ConvertFrom-Json).version"`) do set "APP_VERSION=%%V"
if not defined APP_VERSION (
  echo [ERROR] Could not read the version from package.json.
  exit /b 1
)

call "C:\Program Files\nodejs\npm.cmd" run tauri build -- --bundles nsis
if errorlevel 1 exit /b %errorlevel%

set "OUTPUT_DIR=%~dp0..\安装包"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

set "INSTALLER_FOUND="
for %%F in ("src-tauri\target\release\bundle\nsis\*-setup.exe") do (
  copy /y "%%~fF" "%OUTPUT_DIR%\花笺·新枝-安装程序-v%APP_VERSION%.exe" >nul
  set "INSTALLER_FOUND=1"
)

if not defined INSTALLER_FOUND (
  echo [ERROR] NSIS installer was not generated.
  exit /b 1
)

echo [OK] Installer: %OUTPUT_DIR%\花笺·新枝-安装程序-v%APP_VERSION%.exe
exit /b 0
