#!/usr/bin/env bash
# Chuẩn bị EC2 (Ubuntu 22.04) để chạy Backend + Judge0.
# - Bật cgroup v1 (Judge0 cần cgroup v1 để giới hạn CPU/RAM/tiến trình của code chạy)
# - Cài Docker
# - Cài Caddy làm HTTPS reverse proxy trước Backend — Judge0 KHÔNG public ra internet
set -e

echo "[1/4] Bật cgroup v1 (cần reboot sau bước này để có hiệu lực)..."
sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 systemd.unified_cgroup_hierarchy=0"/' /etc/default/grub
sudo update-grub

echo "[2/4] Cài Docker..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

echo "[3/4] Cài Caddy..."
sudo apt-get update
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy

echo "[4/4] Ghi Caddyfile mẫu (SỬA your-domain.example.com trước khi dùng thật)..."
sudo tee /etc/caddy/Caddyfile > /dev/null <<'CADDY'
your-domain.example.com {
    reverse_proxy 127.0.0.1:3000
}
CADDY
sudo systemctl reload caddy

cat <<'NEXT'

Xong bước cài đặt. CẦN REBOOT để cgroup v1 có hiệu lực:
  sudo reboot

Sau khi reboot, kiểm tra đang ở cgroup v1:
  cat /sys/fs/cgroup/cgroup.controllers   # lệnh này báo lỗi/không tồn tại = đúng, đang ở cgroup v1

Rồi khởi động Judge0 (KHÔNG mở port 2358 ra internet, chỉ Backend trên cùng máy gọi):
  cd infra/judge0
  cp judge0.conf.example judge0.conf   # rồi sửa 2 mật khẩu trong file
  docker compose up -d
NEXT
