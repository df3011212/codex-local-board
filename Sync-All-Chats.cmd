@echo off
setlocal
if exist "%~dp0runtime\node.exe" goto portable
where node >nul 2>nul
if errorlevel 1 goto missing
node "%~dp0sync-all.mjs" sync %*
goto finished
:portable
"%~dp0runtime\node.exe" "%~dp0sync-all.mjs" sync %*
:finished
set "BOARD_SYNC_EXIT=%ERRORLEVEL%"
if not "%BOARD_SYNC_EXIT%"=="0" echo Chat synchronization failed. Existing summaries were kept.
pause
endlocal & exit /b %BOARD_SYNC_EXIT%
:missing
echo Node.js was not found. Keep the full portable folder together.
pause
endlocal & exit /b 2
