@echo off
setlocal
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0open-board.mjs" stop %*
) else (
  node "%~dp0open-board.mjs" stop %*
)
set "BOARD_EXIT=%ERRORLEVEL%"
if not "%BOARD_EXIT%"=="0" pause
endlocal & exit /b %BOARD_EXIT%
