@echo off
REM =============================================================================
REM SETUP PISTON RUNTIMES (Windows Version)
REM Script cài đặt các ngôn ngữ lập trình vào Piston Engine
REM Chạy sau khi container Piston đã khởi động thành công
REM =============================================================================

set CONTAINER_NAME=simutech-piston

echo ⏳ Đang chờ Piston Engine sẵn sàng...

REM Chờ Piston khởi động
:wait_loop
curl -sf http://localhost:2000/api/v2/runtimes >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    timeout /t 2 /nobreak >nul
    goto wait_loop
)

echo ✅ Piston Engine đã sẵn sàng!
echo.
echo 📦 Bắt đầu cài đặt các ngôn ngữ lập trình...
echo ==============================================

echo 🐍 Đang cài đặt Python 3.12.0...
docker exec %CONTAINER_NAME% piston ppman install python 3.12.0

echo 🟨 Đang cài đặt JavaScript (Node.js 20.11.1)...
docker exec %CONTAINER_NAME% piston ppman install node 20.11.1

echo ☕ Đang cài đặt Java 17.0.6...
docker exec %CONTAINER_NAME% piston ppman install java 17.0.6

echo ⚙️  Đang cài đặt C++ (GCC 13.2.0)...
docker exec %CONTAINER_NAME% piston ppman install gcc 13.2.0

echo.
echo ==============================================
echo 🎉 Tất cả ngôn ngữ đã được cài đặt thành công!
echo.
echo 📋 Kiểm tra runtime:
curl -s http://localhost:2000/api/v2/runtimes
echo.
echo 🚀 Piston đã sẵn sàng nhận code execution requests!
pause
