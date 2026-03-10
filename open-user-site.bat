@echo off
REM Opens the customer Casheew website in Google Chrome

set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"

if exist %CHROME_PATH% (
  %CHROME_PATH% "http://localhost:3000"
) else (
  start "" "http://localhost:3000"
)

