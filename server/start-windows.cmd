@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo 已创建 server\.env，请先填写 JWT_SECRET 和 DEVICE_ACCESS_KEY。
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
node --env-file=.env dist\src\server.js
