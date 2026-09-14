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
npm run dev        # chạy server tại http://localhost:3000
npm run simulate   # mô phỏng một buổi phỏng vấn qua server đang chạy
```

Mở `http://localhost:3000/interview-test` để tự test bằng giọng thật, code, và whiteboard.

Bản này dùng **agent AI giả lập** (chưa gọi SageMaker) đứng sau interface cố định trong `src/interview/agents/types.ts` — đổi sang model thật (Qwen/Whisper/viXTTS) là công việc của plan tiếp theo, chỉ cần thay 3 dòng khởi tạo agent trong `src/interview/runtime.ts`.
