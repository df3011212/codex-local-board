@echo off
setlocal
chcp 65001 >nul
if exist "%~dp0runtime\node.exe" goto portable
where node >nul 2>nul
if errorlevel 1 goto missing
node "%~dp0sync-all.mjs" sync %*
goto finished
:portable
"%~dp0runtime\node.exe" "%~dp0sync-all.mjs" sync %*
:finished
set "BOARD_SYNC_EXIT=%ERRORLEVEL%"
if "%BOARD_SYNC_EXIT%"=="0" goto done
if exist "%~dp0runtime\node.exe" goto portablefailed
node -e "console.error('\u540c\u6b65\u672a\u5b8c\u6210\uff0c\u539f\u6709\u6458\u8981\u5df2\u4fdd\u7559\u3002\u672c\u6b21\u53ef\u80fd\u5df2\u4f7f\u7528\u984d\u5ea6\uff0c\u4e0d\u6703\u81ea\u52d5\u91cd\u8a66\u3002')"
goto done
:portablefailed
"%~dp0runtime\node.exe" -e "console.error('\u540c\u6b65\u672a\u5b8c\u6210\uff0c\u539f\u6709\u6458\u8981\u5df2\u4fdd\u7559\u3002\u672c\u6b21\u53ef\u80fd\u5df2\u4f7f\u7528\u984d\u5ea6\uff0c\u4e0d\u6703\u81ea\u52d5\u91cd\u8a66\u3002')"
:done
pause
endlocal & exit /b %BOARD_SYNC_EXIT%
:missing
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "[Console]::Error.WriteLine((-join [char[]](0x627E,0x4E0D,0x5230,0x0020,0x004E,0x006F,0x0064,0x0065,0x002E,0x006A,0x0073,0xFF0C,0x8ACB,0x4FDD,0x7559,0x5B8C,0x6574,0x53EF,0x651C,0x8CC7,0x6599,0x593E,0x3002)))"
pause
endlocal & exit /b 2
