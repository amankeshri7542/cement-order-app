@echo off
rem Removes the program, its queue and its key. Touches nothing in Tally. Run as administrator.
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Right-click this file and choose "Run as administrator".
  exit /b 1
)
schtasks /End /TN "ShivBridge" >nul 2>&1
schtasks /Delete /TN "ShivBridge" /F >nul 2>&1
taskkill /F /FI "IMAGENAME eq node.exe" /FI "MODULES eq ShivBridge" >nul 2>&1
rmdir /S /Q "%ProgramFiles%\ShivBridge"
rmdir /S /Q "%ProgramData%\ShivBridge"
echo Removed. Revoke this PC on the desk too, if it was connected.
endlocal
