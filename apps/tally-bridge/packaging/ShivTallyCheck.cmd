@echo off
rem The read-only check. No install, no admin rights, no service. Run it with the accountant present.
rem Writes one HTML page to Documents, with no party name, amount or phone in it. Sends nothing.
"%~dp0node.exe" "%~dp0app\check.mjs" %*
echo.
pause
