# Ghi chú việc tiếp theo cho module AI Interviewer

> **Trạng thái: chưa phải spec chính thức** — đây là ghi chú yêu cầu ban đầu, thu thập được trong lúc user thử trang `/interview-test` sau khi 20 task nền tảng (nhánh `ai_interviewer`) hoàn tất. Brainstorming cho 2 việc dưới đây đã bắt đầu nhưng bị tạm dừng (máy dev hết dung lượng ổ đĩa để tiếp tục làm việc thoải mái). Ghi lại ở đây để tiếp tục sau, có thể trên máy khác có nhiều tài nguyên hơn.
>
> **Cập nhật 2026-09-15:** Việc 1 (model AI thật + STT thật) đã làm xong ở mức "cắm được, chạy thật, verify qua WS thật" — xem chi tiết cuối mục 1. Việc 2 (whiteboard canvas) vẫn chưa làm.

## Bối cảnh

20 task nền tảng (xem `docs/superpowers/plans/2026-09-14-ai-interviewer-core-module.md`) đã xây xong một module AI Interviewer chạy đầy đủ 6 chặng qua WebSocket + REST, dùng **AI giả lập hoàn toàn** (`FakeLlmAgent`, `FakeSttAgent`, `FakeTtsAgent`) đứng sau interface cố định (`src/interview/agents/types.ts`). Mục đích ban đầu: test đường đi dữ liệu (data path) — không phải test chất lượng AI.

Sau khi thử trang test thủ công (`/interview-test`), user chỉ ra 2 khoảng cách thật giữa cái đã build và cái mong muốn:

## 1. Model AI thật (thay vì `FakeLlmAgent`)

**Yêu cầu của user:** tải 1 model có sẵn trên HuggingFace về chạy local, **chưa cần fine-tuning** — chỉ để test xem AI phỏng vấn có "thông minh" hơn bản giả lập (hiện tại luôn trả lời y hệt "OK, mình hiểu rồi." bất kể ngữ cảnh) hay không.

**Ghi chú kiến trúc:** interface `LlmAgent` (`chat(messages: ChatMessage[], opts): Promise<string>`) đã được thiết kế sẵn để cắm model thật vào mà không cần đụng tới phần còn lại của hệ thống (EventRouter, TurnRunner, WsGateway...). Việc cần làm là viết 1 class mới implement interface này, gọi model HuggingFace chạy local — chưa quyết định:
- Chạy qua công cụ nào (Ollama? text-generation-inference? transformers trực tiếp qua Python subprocess/HTTP server riêng? llama.cpp?)
- Model cụ thể nào (cần cân nhắc kích thước phù hợp với tài nguyên máy dev — máy hiện tại đã rất hạn chế về ổ đĩa/RAM cho Docker, cần tính toán trước khi chọn model)
- Máy dev hiện tại có đủ tài nguyên (RAM/VRAM/đĩa) để chạy 1 model LLM local không — **cần xác minh trước khi chọn hướng, có thể đây là việc phù hợp làm trên máy khác**

**Câu hỏi chưa được hỏi (brainstorming bị gián đoạn ở đây):**
- Model AI thật này thay thế `FakeLlmAgent` mặc định trong `runtime.ts`, hay chỉ dùng khi bật 1 cờ môi trường riêng (giữ fake làm mặc định cho CI/test nhanh)?
- Có cần GPU không, hay chấp nhận chạy CPU-only (chậm hơn nhưng không cần phần cứng đặc biệt)?
- Ưu tiên model tiếng Việt (interview toàn bộ bằng tiếng Việt) hay model đa ngôn ngữ chung cũng được cho bản test này?

**Đã làm (2026-09-15):** máy dev đã có sẵn Ollama (đang chạy ở `:11434`) và vài model đã pull sẵn (`qwen2.5:7b-instruct`, `qwen3:14b`, `qwen3-medvi-test`, `bge-m3`) — không cần tự tải model qua Python/HF trực tiếp, dùng luôn Ollama làm server suy luận. Đã trả lời 3 câu hỏi ở trên:
- Cắm sau cờ môi trường `INTERVIEW_LLM_PROVIDER=ollama` (mặc định vẫn là `fake` để CI/test không đổi) — implementation: `src/interview/agents/ollama-llm-agent.ts` (`OllamaLlmAgent`, `OllamaModelHealth`), nối vào `src/interview/runtime.ts`.
- CPU-only (máy không có GPU) — dùng `qwen2.5:7b-instruct` (4.7GB), đã đo thật ~9-10s/lượt trả lời sau khi model đã load vào RAM.
- Model đa ngôn ngữ (không có bản tiếng Việt riêng) — chất lượng tiếng Việt ổn để test, không hoàn hảo.

**Phát hiện khi tích hợp thật (không thấy khi chỉ dùng `FakeLlmAgent`):** model qua Ollama đôi khi trả `"revealed_constraints": null` / `"covered_topics": null` thay vì `[]`, làm `parseLlmOutput` fail schema (kể cả sau khi `TurnRunner` retry 1 lần — model lặp lại lỗi y hệt) → nếu không sửa, ứng viên sẽ nghe/đọc nguyên văn chuỗi JSON. Đã sửa `src/interview/turn/llm-output-parser.ts` để coi `null` tương đương `[]` cho 2 field này (kèm test `llm-output-parser.test.ts`).

**Đã verify full end-to-end thật (2026-09-15, sau khi user bảo "đâu chạy thử mình xem"):** dựng cả Docker stack (DynamoDB Local, Judge0) + dev server thật với `INTERVIEW_LLM_PROVIDER=ollama`, kết nối WS thật (không qua UI, qua script `ws` client) — AI tự chuyển chặng và trả lời **đúng ngữ cảnh đề bài thật** (nhắc tới ràng buộc ẩn "bỏ qua tối đa 1 ký tự vẫn coi là palindrome" của đề "Valid Palindrome"), khác hẳn câu cố định của bản giả lập.

**Trục trặc môi trường gặp phải khi verify (không phải bug code, ghi lại để đỡ mất thời gian lần sau):**
- Node hệ thống là 18.19.1 — quá cũ cho `vitest@4`/`vite@8` (cần `^20.19 || >=22.12`) và cho `tsx watch server.ts` (Next.js dùng `Array.prototype.toSorted`, ES2023, cần Node 20+). Phải tải Node 22.14.0 binary portable (không cài đè Node hệ thống) để chạy test/dev server.
- `node_modules` ban đầu chưa từng `npm install` trên máy này — cài lần đầu dưới Node 18 làm `rolldown` (dep của vite) resolve nhầm bản `wasm32-wasi` thay vì native — phải `npm install` lại dưới Node 22 mới hết lỗi.
- Container `dynamodb-local` cũ (tạo từ lần chạy trước, không rõ khi nào) không có port publish — `docker compose up -d` không tự sửa vì container đã "Up", phải `down` rồi `up` lại mới áp đúng `ports:` trong compose file.
- Port `8000` (port mặc định của DynamoDB Local) bị chiếm bởi 1 service khác không liên quan đang chạy sẵn trên máy (`~/ai_supporter`, uvicorn) — phải đổi DynamoDB Local sang port `8100` chỉ cho phiên test này (không sửa file compose trong repo, không đụng service kia).
- `aws` CLI chưa cài trên máy (cần cho `database/setup-dynamodb.sh`) — cài qua installer chính thức vào thư mục riêng (không cần sudo, không đụng gì hệ thống).
- `MAX_CONCURRENT_SESSIONS` mặc định là 2 — các phiên test tạo qua script (không đóng đúng cách bằng `session.end`) chiếm hết slot, làm trang `/interview-test` thật gọi API bị `429` rồi crash JS im lặng (không hiện gì cả) — phải restart dev server để dọn state trong lúc dev/test tay.

**Chưa làm / còn để mở:**
- Chưa thử `qwen3:14b` (chất lượng có thể tốt hơn nhưng chậm hơn trên CPU, chưa đo số liệu thật).
- README đã có hướng dẫn bật cả 2 cờ (`README.md`, mục "Cắm model AI thật làm bộ não" và "Cắm model AI thật làm tai nghe").

## 1b. STT thật (thay vì `FakeSttAgent`) — làm thêm theo yêu cầu user, không có trong ghi chú gốc

**Yêu cầu của user:** sau khi thấy LLM thật chạy được, user nhận ra qua UI thật là STT vẫn giả (`/interview-test` không "nghe" được gì) và yêu cầu làm luôn STT thật, cũng không cần fine-tune.

**Đã làm (2026-09-15):** máy dev có sẵn model `Systran/faster-whisper-medium` trong HF cache — dùng `faster-whisper` (CTranslate2, không cần torch/GPU) chạy qua 1 server Python nhỏ (`infra/stt-whisper/server.py`, FastAPI + uvicorn, cả 2 package đã có sẵn hệ thống). Node gọi qua HTTP (`src/interview/agents/whisper-stt-agent.ts` — `WhisperSttAgent`, `checkWhisperHealth`), cắm sau cờ `INTERVIEW_STT_PROVIDER=whisper` (độc lập với cờ LLM). `ModelHealth` được refactor thành `CompositeModelHealth` (`src/interview/agents/composite-model-health.ts`) để ghép health-check của cả LLM lẫn STT thay vì hardcode `true`.

**Cài đặt Python không đụng hệ thống:** `pip3 install --target infra/stt-whisper/vendor faster-whisper` (không venv, không `--break-system-packages`, không sudo — giống cách `node_modules` cô lập dependency của npm). `python3 -m venv` bị chặn vì thiếu gói `python3.12-venv` (cần sudo) nên dùng `--target` thay vì venv.

**Phát hiện khi tích hợp thật:** Whisper (không bật VAD) "ảo giác" ra câu hoàn chỉnh (vd. "Hãy đăng ký kênh để xem những video mới nhất.") khi input là **im lặng hoàn toàn** — lỗi kinh điển của Whisper decode hết cả đoạn không có giọng nói. Đã fix bằng `vad_filter=True` trong `server.py`, verify lại: input im lặng → trả `""` đúng.

**Đã verify:** gọi `/transcribe` thật qua curl (im lặng → rỗng, đúng), và chạy full pipeline qua WS thật (`speech.start` → gửi PCM16 im lặng → `speech.end`) trong app thật (không phải unit test) — không lỗi, không hallucinate.

**Chưa làm / còn để mở:**
- Chưa test với giọng nói tiếng Việt thật (chỉ test được với audio im lặng do môi trường agent không có cách tạo mẫu giọng nói) — user cần tự thử qua micro ở `/interview-test` để đánh giá độ chính xác thật.

**Bug thật thứ 2 phát hiện khi user tự thử trên trình duyệt thật (2026-09-15, sau khi LLM+STT đã chạy):** `FakeTtsAgent` trả về `Buffer.from("FAKE_AUDIO:"+text)` — bytes text thô, không phải PCM16 hợp lệ. Trang `/interview-test` (`playAudioChunk`) coi MỌI binary WS frame là PCM16 24kHz thật và gọi `new Int16Array(buf)` — độ dài lẻ (tùy độ dài câu trả lời) làm `RangeError: byte length ... should be a multiple of 2`, crash luồng xử lý message ngay khi AI "nói" lần đầu → đây có thể là lý do chính khiến user "không thấy gì" dù server/API hoạt động đúng. Đã sửa `FakeTtsAgent` trả về `Buffer.alloc(text.length*2, 0)` (PCM16 hợp lệ, im lặng) — không có test nào assert nội dung buffer, chỉ `length > 0`, nên an toàn để đổi.

**Bài học:** cả 2 bug thật (STT hallucinate, TTS crash) đều KHÔNG lộ ra qua unit test hay qua script test WS tự viết (dùng buffer/audio giả tùy ý) — chỉ lộ ra khi chạy đúng luồng thật (browser thật gọi Web Audio API, hoặc STT server thật xử lý input thật). Việc user yêu cầu "chạy thử" thay vì chỉ tin vào kết quả unit test là đúng đắn.

## 2. Whiteboard canvas thật (thay vì ô nhập JSON tay)

**Yêu cầu của user:** ô nhập JSON hiện tại (`{"nodes":[...],"edges":[...]}`) không mô phỏng được trải nghiệm thật — cần 1 canvas vẽ thật giống drawio/Excalidraw/tldraw, để ứng viên vẽ bằng chuột như phỏng vấn thật.

**Ghi chú kiến trúc:** giao thức WS đã có sẵn `whiteboard.update`/`whiteboard.done` nhận `WhiteboardState { nodes: WhiteboardNode[], edges: WhiteboardEdge[] }` — chỉ cần thay phần UI (`src/app/interview-test/page.tsx`) để sinh ra đúng cấu trúc dữ liệu này từ thao tác vẽ, không cần đổi giao thức backend.

**Đã làm (2026-09-15):** chọn Excalidraw (user chọn qua câu hỏi trực tiếp — MIT license, tích hợp React sẵn, UI giống whiteboard thật). Cài `@excalidraw/excalidraw`, thay ô textarea JSON bằng `<Excalidraw onChange={...}>` trong `page.tsx`. Viết `src/app/interview-test/excalidraw-to-whiteboard.ts` (`excalidrawToWhiteboardState`) suy đồ thị node/edge từ scene Excalidraw (xem README mục "Whiteboard canvas thật"). `onChange` debounce 400ms trước khi gửi `whiteboard.update` (Excalidraw gọi callback trên từng nét vẽ nhỏ, gửi ngay sẽ dồn WS).

**Đã verify:** `tsc --noEmit` sạch (bắt được 2 lỗi type thật lúc viết: `ExcalidrawElement` phải import từ `@excalidraw/excalidraw/element/types` chứ không phải `/types`; `Buffer` không gán thẳng được vào `BodyInit` của `fetch` trong `whisper-stt-agent.ts`, phải bọc `new Uint8Array(wav)` — sửa cả 2), dev server compile không lỗi, trang `/interview-test` load được (SSR trả đúng trạng thái loading vì Excalidraw dùng `next/dynamic({ssr:false})`).

**Chưa làm / còn để mở:**
- Chưa tự vẽ thử bằng chuột thật trong môi trường agent (không có cách điều khiển chuột/trình duyệt) — user cần tự vẽ 1-2 hình + mũi tên ở `/interview-test` để xác nhận `excalidrawToWhiteboardState` suy ra đúng node/edge như kỳ vọng, đặc biệt trường hợp mũi tên không bind đúng 2 đầu (bị bỏ qua, có thể gây khó hiểu nếu user không biết vì sao 1 mũi tên "biến mất" khỏi payload gửi AI).

**Câu hỏi chưa được hỏi:**
- Dùng thư viện có sẵn (Excalidraw, tldraw) hay tự vẽ canvas tối giản bằng SVG/Canvas API?
- Nếu dùng thư viện ngoài — cần cân nhắc license, kích thước bundle, và việc chuyển đổi giữa định dạng nội bộ của thư viện đó và `WhiteboardState` của hệ thống.

## Việc cần làm tiếp

1. Chốt lại 2 việc này làm song song hay tuần tự (model AI trước hay whiteboard trước) — user đang được hỏi thì bị gián đoạn.
2. Nếu tiếp tục trên máy khác: máy dev hiện tại (`/home/bias29/Demo-SimuTech-Backend`) có 1 project Docker khác không liên quan (Dify) chiếm phần lớn dung lượng ổ đĩa (~10GB), cộng với các image DynamoDB Local/Judge0 của chính module này — cần dọn hoặc chuyển máy trước khi làm việc nặng (tải model AI, thử nghiệm nhiều).
3. Sau khi chốt câu trả lời, quay lại quy trình `superpowers:brainstorming` (architectural path) cho từng việc — đề xuất phương án, viết spec, rồi `superpowers:writing-plans`.
