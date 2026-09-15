This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Module AI Interviewer (bản test với model gốc)

Thiết kế: `docs/superpowers/specs/2026-09-14-ai-interviewer-module-design.md`. Kế hoạch triển khai: `docs/superpowers/plans/2026-09-14-ai-interviewer-core-module.md`.

Chạy toàn bộ ở máy dev (không cần AWS — dùng agent AI giả lập, Judge0 và DynamoDB chạy local bằng Docker):

```bash
npm install
docker compose -f infra/dynamodb-local/docker-compose.yml up -d
ENDPOINT_URL="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local ./database/setup-dynamodb.sh
ENDPOINT_URL="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local ./database/setup-interview-sessions-table.sh
cd infra/judge0 && cp judge0.conf.example judge0.conf && docker compose up -d && cd ../..

npm test           # toàn bộ unit + integration test
DDB_ENDPOINT="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local npm run dev   # chạy server tại http://localhost:3000
npm run simulate   # mô phỏng một buổi phỏng vấn qua server đang chạy
```

Mở `http://localhost:3000/interview-test` để tự test bằng giọng thật, code, và whiteboard.

Bản này dùng **agent AI giả lập** (chưa gọi SageMaker) đứng sau interface cố định trong `src/interview/agents/types.ts` — đổi sang model thật (Qwen/Whisper/viXTTS) là công việc của plan tiếp theo, chỉ cần thay 3 dòng khởi tạo agent trong `src/interview/runtime.ts`.

### Cắm model AI thật làm "bộ não" (LLM) — dùng Ollama local

`FakeLlmAgent` luôn trả lời cố định "OK, mình hiểu rồi." bất kể ngữ cảnh — chỉ để test data path. Để thử một model HuggingFace thật (chưa fine-tune), bật `INTERVIEW_LLM_PROVIDER=ollama` — STT/TTS vẫn dùng bản giả lập (xem `docs/superpowers/specs/2026-09-15-ai-interviewer-followup-ideas.md`):

```bash
# Cần Ollama đã cài và đang chạy (mặc định http://127.0.0.1:11434), model đã pull sẵn:
ollama pull qwen2.5:7b-instruct

INTERVIEW_LLM_PROVIDER=ollama \
DDB_ENDPOINT="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
npm run dev
```

Biến môi trường liên quan (tất cả có giá trị mặc định hợp lý, không bắt buộc set):
- `INTERVIEW_LLM_PROVIDER` — `fake` (mặc định, dùng cho test/CI) hoặc `ollama`.
- `OLLAMA_BASE_URL` — mặc định `http://127.0.0.1:11434`.
- `OLLAMA_MODEL` — mặc định `qwen2.5:7b-instruct` (~4.7GB, chạy được CPU-only, đã test thật ~9-10s/lượt trả lời trên máy dev không GPU). Model khác đã có sẵn trên máy dev: `qwen3:14b`, `qwen3-medvi-test`.

Nếu Ollama không chạy hoặc model chưa pull, endpoint tạo session (`POST /api/interview/sessions`) sẽ báo lỗi thay vì tạo phiên (xem `checkOllamaHasModel` trong `src/interview/agents/ollama-llm-agent.ts`).

### Cắm model AI thật làm "tai nghe" (STT) — dùng faster-whisper local

`FakeSttAgent` luôn trả về "" (không nghe được gì) — micro trên `/interview-test` sẽ không hoạt động với bản giả lập. Để nghe giọng nói thật (model `faster-whisper-medium`, chưa fine-tune), cần chạy 1 server Python riêng rồi bật `INTERVIEW_STT_PROVIDER=whisper`:

```bash
# 1 lần duy nhất — cài faster-whisper vào infra/stt-whisper/vendor (không đụng Python hệ thống):
pip3 install --target infra/stt-whisper/vendor faster-whisper

# Chạy server STT (giữ chạy nền, load model ~vài giây rồi lắng nghe ở :8200):
infra/stt-whisper/run.sh

# Terminal khác — bật cờ khi chạy dev server:
INTERVIEW_LLM_PROVIDER=ollama INTERVIEW_STT_PROVIDER=whisper \
DDB_ENDPOINT="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
npm run dev
```

Biến môi trường:
- `INTERVIEW_STT_PROVIDER` — `fake` (mặc định) hoặc `whisper`.
- `WHISPER_BASE_URL` — mặc định `http://127.0.0.1:8200`.
- `WHISPER_MODEL` (đặt khi chạy `run.sh`) — mặc định `Systran/faster-whisper-medium`.

Server bật sẵn `vad_filter=True` để tránh Whisper "ảo giác" ra câu khi input toàn im lặng (lỗi thật gặp phải khi tích hợp — không có VAD, model liên tục trả về những câu vô nghĩa kiểu "Hãy đăng ký kênh..." dù không ai nói gì).

### Whiteboard canvas thật (Excalidraw)

`/interview-test` dùng [Excalidraw](https://github.com/excalidraw/excalidraw) thay vì ô nhập JSON tay — vẽ hình/mũi tên bằng chuột như whiteboard thật. `src/app/interview-test/excalidraw-to-whiteboard.ts` suy ra `WhiteboardState { nodes, edges }` từ scene của Excalidraw: hình khối (rectangle/ellipse/diamond) hoặc text đứng riêng → node; arrow/line có 2 đầu bind vào 2 element khác → edge (arrow không bind đủ 2 đầu bị bỏ qua vì không suy ra được `from`/`to`). Giao thức WS (`whiteboard.update`/`whiteboard.done`) không đổi.
