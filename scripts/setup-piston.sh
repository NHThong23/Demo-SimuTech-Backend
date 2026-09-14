#!/bin/bash
# =============================================================================
# SETUP PISTON RUNTIMES
# Script cài đặt các ngôn ngữ lập trình vào Piston Engine
# Chạy sau khi container Piston đã khởi động thành công
# =============================================================================

set -e

CONTAINER_NAME="simutech-piston"

echo "⏳ Đang chờ Piston Engine sẵn sàng..."

# Chờ tối đa 60 giây cho Piston khởi động
for i in $(seq 1 60); do
    if curl -sf http://localhost:2000/api/v2/runtimes > /dev/null 2>&1; then
        echo "✅ Piston Engine đã sẵn sàng!"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "❌ Timeout: Piston Engine không phản hồi sau 60 giây."
        exit 1
    fi
    sleep 1
done

echo ""
echo "📦 Bắt đầu cài đặt các ngôn ngữ lập trình..."
echo "=============================================="

# --- Python 3.12 ---
echo "🐍 Đang cài đặt Python 3.12.0..."
docker exec $CONTAINER_NAME piston ppman install python 3.12.0
echo "   ✅ Python 3.12.0 đã cài xong."

# --- JavaScript (Node.js 20) ---
echo "🟨 Đang cài đặt JavaScript (Node.js 20.11.1)..."
docker exec $CONTAINER_NAME piston ppman install node 20.11.1
echo "   ✅ Node.js 20.11.1 đã cài xong."

# --- Java 17 ---
echo "☕ Đang cài đặt Java 17.0.6..."
docker exec $CONTAINER_NAME piston ppman install java 17.0.6
echo "   ✅ Java 17.0.6 đã cài xong."

# --- C++ (GCC 13) ---
echo "⚙️  Đang cài đặt C++ (GCC 13.2.0)..."
docker exec $CONTAINER_NAME piston ppman install gcc 13.2.0
echo "   ✅ GCC 13.2.0 (C/C++) đã cài xong."

echo ""
echo "=============================================="
echo "🎉 Tất cả ngôn ngữ đã được cài đặt thành công!"
echo ""
echo "📋 Danh sách runtime hiện có:"
curl -s http://localhost:2000/api/v2/runtimes | python3 -m json.tool 2>/dev/null || \
curl -s http://localhost:2000/api/v2/runtimes
echo ""
echo "🚀 Piston đã sẵn sàng nhận code execution requests!"
