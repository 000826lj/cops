@echo off
setlocal
cd /d "%~dp0"
curl.exe --fail --show-error http://127.0.0.1:3000/health
if errorlevel 1 (
  echo.
  echo 服务端未正常响应，请检查 start-windows.cmd 窗口。
  exit /b 1
)
echo.
echo 本机服务端响应正常。
