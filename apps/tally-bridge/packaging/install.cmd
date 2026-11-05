@echo off
rem Installs the Tally bridge on this PC. Run as administrator, with the accountant present.
rem It makes no change to Tally, and opens no port on this PC.
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Right-click this file and choose "Run as administrator".
  exit /b 1
)
set "TARGET=%ProgramFiles%\ShivBridge"
set "DATA=%ProgramData%\ShivBridge"
mkdir "%TARGET%" 2>nul
mkdir "%DATA%" 2>nul
copy /Y "%~dp0node.exe" "%TARGET%\node.exe" >nul || exit /b 1
xcopy /E /I /Y /Q "%~dp0app" "%TARGET%\app" >nul || exit /b 1
rem The key and the queue are for this program, administrators and Windows itself, and nobody else.
rem S-1-5-19 is LOCAL SERVICE, S-1-5-32-544 is Administrators, S-1-5-18 is SYSTEM.
icacls "%DATA%" /inheritance:r /grant:r "*S-1-5-19:(OI)(CI)M" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" >nul || exit /b 1
schtasks /Create /TN "ShivBridge" /XML "%~dp0ShivBridge-task.xml" /F >nul || exit /b 1
echo.
echo Installed. Next, with the code from the desk:
echo   "%TARGET%\node.exe" "%TARGET%\app\main.mjs" pair 12345678 --api https://YOUR-API-ADDRESS
echo   schtasks /Run /TN ShivBridge
endlocal
