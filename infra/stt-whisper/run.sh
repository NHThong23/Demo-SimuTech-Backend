#!/usr/bin/env bash
# Chạy STT server thật (faster-whisper). Cần đã cài package vào ./vendor (pip install --target vendor faster-whisper).
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH="$(pwd)/vendor:${PYTHONPATH:-}"
exec python3 -m uvicorn server:app --host 127.0.0.1 --port "${WHISPER_PORT:-8200}"
