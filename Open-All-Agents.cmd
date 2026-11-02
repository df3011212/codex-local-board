@echo off
setlocal
set "CODEX_THREAD_ID="
if not exist "%~dp0runtime\node.exe" goto missing
if not exist "%~dp0vendor\codex-agent-view\bin\codex-agent-view.mjs" goto missing
"%~dp0runtime\node.exe" "%~dp0vendor\codex-agent-view\bin\codex-agent-view.mjs" open >nul 2>nul
set "CAV_EXIT=%ERRORLEVEL%"
if not "%CAV_EXIT%"=="0" goto failed
echo Agent View opened in your default browser.
endlocal & exit /b 0
:missing
echo The portable launcher is incomplete. Keep this entire folder together.
pause
endlocal & exit /b 2
:failed
echo Agent View could not open. Exit code: %CAV_EXIT%.
echo Keep this window open and report this code. No private URL is printed.
pause
endlocal & exit /b %CAV_EXIT%
