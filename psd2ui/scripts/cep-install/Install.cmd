@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"
set "PSD2UI_INSTALL_EXIT=%ERRORLEVEL%"
echo.
if not "%PSD2UI_INSTALL_EXIT%"=="0" echo Installation did not complete. See the message above.
pause
exit /b %PSD2UI_INSTALL_EXIT%
