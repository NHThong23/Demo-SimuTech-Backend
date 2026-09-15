"""STT server thật dùng faster-whisper (model medium, chưa fine-tune) — xem
docs/superpowers/specs/2026-09-15-ai-interviewer-followup-ideas.md. Chạy: `./run.sh`.
Nhận WAV (16kHz mono PCM16) qua POST /transcribe, trả JSON {"text": "..."}.
"""
import io
import os

from fastapi import FastAPI, Request
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "Systran/faster-whisper-medium")
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


@app.post("/transcribe")
async def transcribe(request: Request):
    wav_bytes = await request.body()
    # vad_filter=True bỏ qua đoạn im lặng — không có nó, Whisper hay "ảo giác" ra câu (vd. "Hãy đăng ký kênh...")
    # trên input im lặng, một lỗi kinh điển của Whisper khi decode toàn bộ audio kể cả chỗ không có giọng nói.
    segments, _info = model.transcribe(io.BytesIO(wav_bytes), language="vi", beam_size=1, vad_filter=True)
    text = "".join(segment.text for segment in segments).strip()
    return {"text": text}
