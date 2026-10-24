@echo off
rem Opens Leaflet in its own app window (no browser tabs or address bar).
rem Uses Microsoft Edge, which is built into Windows 10 and 11, or Google Chrome if present.
setlocal
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
