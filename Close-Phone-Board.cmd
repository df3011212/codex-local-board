@echo off
setlocal
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0private-access.mjs" disable %*
) else (
  node "%~dp0private-access.mjs" disable %*
)
set "PHONE_EXIT=%ERRORLEVEL%"
pause
endlocal & exit /b %PHONE_EXIT%
