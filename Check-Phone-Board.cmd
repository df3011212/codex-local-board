@echo off
setlocal
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0private-access.mjs" status %*
) else (
  node "%~dp0private-access.mjs" status %*
)
set "PHONE_EXIT=%ERRORLEVEL%"
pause
endlocal & exit /b %PHONE_EXIT%
