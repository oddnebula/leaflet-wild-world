@echo off
rem Opens Leaflet in its own app window (no browser tabs or address bar), with Leaflet Helper beside it for Cartridge
rem Sync (Play on melonDS and more). Uses Microsoft Edge, which is built into Windows 10 and 11, or Google Chrome.
setlocal
set "HELPER=%~dp0app\Leaflet Helper.ps1"
set "STARTED=%LOCALAPPDATA%\Leaflet\helper-started"
if not exist "%HELPER%" goto plain
del "%STARTED%" 2>nul
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%HELPER%"
rem The helper opens the window itself. If it hasn't within about fifteen seconds, open Leaflet without it.
for /l %%i in (1,1,15) do (
  if exist "%STARTED%" exit /b 0
  ping -n 2 127.0.0.1 >nul
)

:plain
set "PAGE=%~dp0app\index.html"
set "URL=file:///%PAGE:\=/%"
set "PROFILE=%LOCALAPPDATA%\Leaflet\profile"

for %%B in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
) do (
  if exist %%B (
    start "" %%B --app="%URL%" --user-data-dir="%PROFILE%" --window-size=1240,820 --no-first-run
    exit /b 0
  )
)

rem No Edge or Chrome found: open in the default browser instead.
start "" "%PAGE%"
