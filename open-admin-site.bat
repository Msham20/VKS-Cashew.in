@echo off
REM Opens the Casheew admin login page in Google Chrome

set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"

if exist %CHROME_PATH% (
  %CHROME_PATH% "http://localhost:3000/admin/login"
) else (
  start "" "http://localhost:3000/admin/login"
)

