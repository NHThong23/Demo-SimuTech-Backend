# Spec — Module AI Interviewer (bản test với model gốc)

- **Ngày:** 2026-09-14
- **Nhánh:** `ai_interviewer`
- **Tài liệu gốc:** `ke_hoach_kien_truc_he_thong_mock_interviewer.md` (spec này thay thế các phần kỹ thuật chưa chính xác trong đó — xem mục 12)

---

## 1. Mục tiêu và phạm vi

### 1.1. Mục tiêu
Xây một **module AI-powered** gắn vào website luyện code hiện có, cho phép chạy **một buổi phỏng vấn thử 1-1** với AI trên các đề bài có sẵn trong bảng `Problems`, qua **3 kênh**: giọng nói, code editor, whiteboard.

Bản này dùng **model gốc chưa fine-tune** để:
1. kiểm chứng toàn bộ luồng chạy thật end-to-end;
2. thu **số liệu** (độ trễ, tỷ lệ lỗi, chất lượng phản hồi) làm cơ sở cho việc fine-tune sau.

### 1.2. Trong phạm vi
- Backend: REST + WebSocket, quản lý phiên, kịch bản 6 chặng, điều phối gọi AI, lưu trữ, metrics.
- Tích hợp thật: SageMaker (Qwen2.5-Coder-7B-Instruct, Whisper large-v3-turbo, viXTTS), Judge0 CE.
- Script hạ tầng: deploy/teardown/status SageMaker, cài Judge0.
- Cập nhật dữ liệu bảng `Problems` (2 trường tùy chọn mới) và tạo bảng `InterviewSessions`.
- Công cụ test: unit, tích hợp, live, script mô phỏng buổi phỏng vấn, trang test tối giản `/interview-test`.

### 1.3. Ngoài phạm vi
- Frontend chính (nằm ở repo riêng; repo này chỉ cung cấp giao thức + trang test tối giản).
- Chấm điểm số / barem (chỉ **nhận xét định tính** theo 4 trụ cột).
- Đăng nhập/xác thực người dùng (mỗi phiên dùng token ngẫu nhiên).
- Fine-tune model, scale-to-zero, Redis, lưu file ghi âm.
- Tiếp tục buổi phỏng vấn đang dở sau khi backend khởi động lại.
- Quay lại chặng trước.

---

## 2. Kiến trúc tổng thể

```
Frontend (repo riêng) / trang /interview-test
   │  REST: /api/interview/...        WS: /ws/session/:id?token=...
   ▼
┌──────────────── Backend (repo này, 1 tiến trình Node) ─────────────────┐
│ server.ts ── Next.js (REST, trang test) + ws (xử lý upgrade /ws/*)     │
│                                                                         │
│ src/interview/                                                          │
│   protocol/     schema message (zod), dùng chung với frontend           │
│   config/       cấu hình chặng, ngưỡng, timeout (đọc từ env + mặc định) │
│   session/      Session (state trong RAM), SessionManager, StageMachine │
│   router/       EventRouter: trigger gọi AI, bộ đếm im lặng, hàng đợi  │
│   turn/         TurnRunner, PromptBuilder, LlmOutputParser              │
│   agents/       interface + impl SageMaker / Judge0 + bản giả cho test │
│   evaluation/   tạo bản nhận xét 4 trụ cột cuối buổi                   │
│   persistence/  ProblemRepository, InterviewRepository (DynamoDB)      │
│   metrics/      ghi độ trễ, lỗi theo từng lượt                          │
│   ws/           WsGateway: xác thực, parse message, gửi message         │
└─────────────────────────────────────────────────────────────────────────┘
   │ AWS SDK v3                                   │ HTTP
   ▼                                              ▼
SageMaker (ml.g5.xlarge): Qwen2.5-Coder-7B        Judge0 CE (docker, cùng EC2)
SageMaker (ml.g4dn.xlarge): Whisper + viXTTS
   (2 Inference Components chung 1 GPU)
DynamoDB: Problems (có sẵn), InterviewSessions (mới)
```

### 2.1. Phân chia trách nhiệm

| Việc | Ai quyết định |
|---|---|
| Nói gì, hỏi gì, gợi ý gì, ghi chú gì | Qwen (qua `TurnRunner`) |
| Có được chuyển chặng không | `StageMachine` (code thuần). Qwen chỉ **đề xuất** |
| Code đúng hay sai | Judge0 |
| Khi nào gọi Qwen | `EventRouter` |

### 2.2. Nguyên tắc thiết kế
- `agents/` là lớp duy nhất biết cách gọi model. Đổi sang model fine-tune = đổi tên endpoint trong `.env`.
- `StageMachine`, `EventRouter`, `PromptBuilder`, `LlmOutputParser` là code thuần, **test được không cần AWS**, nhận đồng hồ (`Clock`) qua tham số để test bộ đếm thời gian bằng đồng hồ giả.
- Mỗi file một trách nhiệm; interface giữa các phần là type TypeScript rõ ràng.

### 2.3. Lưu ý kỹ thuật Next.js custom server
- `server.ts` tạo `http.Server`, chuyển request HTTP cho `next.getRequestHandler()`. Sự kiện `upgrade`: đường dẫn bắt đầu bằng `/ws/session/` do `ws` xử lý; mọi upgrade khác (ví dụ HMR của Next khi dev) chuyển cho `next.getUpgradeHandler()`.
- Route handler của Next và `server.ts` có thể được nạp thành **hai bản module khác nhau**. Vì vậy `SessionManager` và các singleton khác được lưu trên `globalThis` (qua một hàm `getInterviewRuntime()`), để REST và WS dùng chung một instance.
- Không deploy lên Vercel (không hỗ trợ WebSocket lâu dài); chạy trên EC2.

---

## 3. Kịch bản 6 chặng

### 3.1. Bảng chặng

| # | Chặng | Tối thiểu → tối đa | Kênh | Ngưỡng im lặng | Vai trò AI | Điều kiện cứng để chuyển |
|---|---|---|---|---|---|---|
| 1 | Làm rõ yêu cầu (Clarification) | 3 → 5 phút | voice | 10s | Trình bày đề **thiếu ràng buộc**; chỉ tiết lộ một mục `hidden_constraints` khi ứng viên hỏi đúng ý hoặc tự đặt giả định cần xác nhận | không có |
| 2 | Thảo luận giải thuật (Approach) | 5 → 10 phút | voice + whiteboard (tùy chọn) | 20s | Đồng thuận hoặc phản biện (giải thuật chậm, Big-O sai) | không có |
| 3 | Viết mã (Coding) | 15 → 25 phút | voice + editor | 45s | **Mặc định im lặng quan sát**; gợi mở khi im lặng quá ngưỡng | đã `code.run` ít nhất 1 lần |
| 4 | Tự kiểm thử & gỡ lỗi (Testing) | 5 → 10 phút | voice + editor | 20s | Yêu cầu ứng viên tự nghĩ test; nếu ứng viên cho là ổn mà test ẩn còn fail → đưa **test phản chứng lấy từ test ẩn đang fail** | không có |
| 5 | Mở rộng & phản biện (Follow-up) | 5 → 10 phút | voice + **whiteboard (chính)** | 20s | Hỏi theo `follow_up_topics`; hết chủ đề thì tự đặt câu hỏi sâu hơn; đọc sơ đồ kiến trúc | không có |
| 6 | Đánh giá & wrap-up | 0 → 5 phút | voice | 10s | Trả lời câu hỏi ngược của ứng viên; kết thúc → tạo bản nhận xét | — |

Tổng tối đa: 65 phút. Toàn bộ số liệu trong bảng nằm ở `config/stages.ts`, ngưỡng im lặng được kiểm tra nằm trong khoảng **5–45 giây**.

### 3.2. Luật chuyển chặng (StageMachine)
Chặng hiện tại chuyển sang chặng kế tiếp khi xảy ra **một** trong các trường hợp sau và **điều kiện cứng** (cột cuối bảng) đã thỏa:

1. **Qwen đề xuất** (`action: "next_stage"`). Được phép ở bất kỳ thời điểm nào, kể cả trước mức tối thiểu — prompt hướng dẫn Qwen chỉ đề xuất sớm khi mục tiêu chặng đã đạt (ví dụ đã làm rõ hết ràng buộc).
2. **Ứng viên bấm "xong"** (`stage.done`).
3. **Chặng 4:** test ẩn pass hết → tự đề xuất chuyển (AI nói câu chuyển tiếp ở lượt kế).
4. **Chạm mức tối đa** → **bắt buộc chuyển**, bỏ qua điều kiện cứng. Riêng chặng 3 nếu chưa chạy code lần nào vẫn chuyển, và ghi nhận vào dữ liệu đánh giá.

Nếu `stage.done` hoặc đề xuất của Qwen bị từ chối vì chưa thỏa điều kiện cứng: backend gửi `error` với `code: "STAGE_PRECONDITION"` (với `stage.done`), hoặc bỏ qua đề xuất và nhắc ứng viên trong lượt nói (với Qwen).

**Mốc tối thiểu** chỉ có tác dụng: trước mốc này, prompt dặn Qwen không hối thúc ứng viên.
**Mốc nhắc giờ:** khi đã dùng 80% thời gian tối đa của chặng, EventRouter tạo trigger `time_warning` (một lần mỗi chặng).
Chuyển sang chặng 6 xong và ứng viên bấm `session.end` (hoặc hết 5 phút) → tạo bản nhận xét, phiên chuyển `completed`.
Chỉ đi tới, không quay lại.

### 3.3. Dữ liệu đề bài dùng cho các chặng
Item đề bài trong `Problems` có thêm 2 trường **tùy chọn**:
```json
"hidden_constraints": ["Mảng có thể có số âm", "Luôn có đúng 1 đáp án", "Không dùng 1 phần tử 2 lần", "Độ dài tối đa 10^5"],
"follow_up_topics":   ["Nếu mảng đã được sắp xếp?", "Nếu dữ liệu không vừa RAM một máy?", "Nếu cần trả về tất cả các cặp?"]
```
Thiếu trường nào thì prompt yêu cầu Qwen tự suy ra từ mô tả đề. Test ẩn = các phần tử `test_cases` có `is_sample: false`.

**Khi nào chạy test ẩn:** (a) ở chặng 4, mỗi lần ứng viên `code.run` (dù `sample` hay `custom`), backend chạy thêm toàn bộ test ẩn trên code hiện tại ở chế độ ngầm; (b) khi kết thúc chặng 4 và khi kết thúc buổi, chạy trên code cuối để lấy số liệu cho bản nhận xét. Ngoài hai thời điểm này không chạy test ẩn.

---

## 4. Giao thức Frontend ↔ Backend

### 4.1. REST

| API | Request | Response |
|---|---|---|
| `POST /api/interview/sessions` | `{ problemId?: string, language: "python" \| "javascript" \| "cpp", userId?: string }` | `201 { sessionId, token, problem: { problemId, title, description, starterCode, sampleTests: [{id, input, output}] }, stages: [{ index, name, minSec, maxSec }] }` |
| `GET /api/interview/sessions/:id` | header `Authorization: Bearer <token>` | `{ meta, turns, runs, evaluation? , metrics }` |

- Không truyền `problemId` → chọn ngẫu nhiên một đề.
- Trước khi tạo phiên, kiểm tra các endpoint SageMaker ở trạng thái `InService` (kết quả cache 30 giây). Không sẵn sàng → `503 { code: "MODELS_NOT_READY", details: { qwen, stt, tts } }`.
- Vượt số phiên đồng thời tối đa (mặc định 2, vì chỉ có 1 GPU mỗi loại) → `429 { code: "TOO_MANY_SESSIONS" }`.
- `hidden_constraints`, `follow_up_topics`, test ẩn **không bao giờ** trả về frontend.

### 4.2. WebSocket
- URL: `wss://<host>/ws/session/:id?token=<token>`. Sai token hoặc phiên không tồn tại → đóng với mã `4401` / `4404`.
- Mỗi phiên tối đa **1 kết nối** đang mở; kết nối mới thay thế kết nối cũ (đóng cũ bằng mã `4409`).
- Tin nhắn chữ: JSON `{ "type": string, "data"?: object }`. Tin nhắn nhị phân: chỉ chứa âm thanh.
- Giới hạn: tin nhắn ≤ 1 MB; code ≤ 64 KB; whiteboard ≤ 200 node và 400 edge. Vượt giới hạn → `error` `PAYLOAD_TOO_LARGE`.
- Message sai schema → `error` `INVALID_MESSAGE` (không đóng kết nối).

#### Frontend → Backend

| type | data | Ghi chú |
|---|---|---|
| `speech.start` | — | VAD frontend phát hiện bắt đầu nói |
| *(nhị phân)* | PCM 16-bit little-endian, 16 kHz, mono | chỉ gửi trong lúc đang nói |
| `speech.pause` | — | im lặng ≥ 0,8 giây: backend chạy Whisper trước trên phần audio đã có |
| `speech.end` | — | im lặng đủ ngưỡng của chặng **hoặc** ứng viên bấm "Em nói xong" |
| `editor.update` | `{ code, language }` | frontend debounce 1 giây, gửi nguyên code |
| `code.run` | `{ customInput?: string }` | có `customInput` → chạy với input đó; không có → chạy test mẫu |
| `whiteboard.update` | `{ nodes: [{id, label, x, y}], edges: [{from, to, label?}] }` | debounce 1 giây |
| `whiteboard.done` | — | bấm "Xong sơ đồ" |
| `stage.done` | — | bấm "Em xong phần này" |
| `session.end` | — | bấm "Kết thúc" |

Ngưỡng im lặng của chặng hiện tại được gửi trong `session.state` để VAD frontend dùng.
Một lượt nói dài quá 90 giây → backend tự coi như `speech.end`.

#### Backend → Frontend

| type | data |
|---|---|
| `session.state` | `{ stage, stageName, stageElapsedSec, stageMinSec, stageMaxSec, silenceThresholdSec, aiStatus: "idle" \| "listening" \| "transcribing" \| "thinking" \| "speaking", status: "active" \| "completed" \| "abandoned" }` — gửi khi kết nối, khi chuyển chặng, khi `aiStatus` đổi |
| `transcript.user` | `{ utteranceId, text }` |
| `ai.reply` | `{ utteranceId, text }` |
| `ai.speech.start` | `{ utteranceId, sampleRate: 24000, format: "pcm16" }` |
| *(nhị phân)* | PCM 16-bit, 24 kHz, mono của `utteranceId` đang phát |
| `ai.speech.end` | `{ utteranceId }` |
| `ai.speech.cancelled` | `{ utteranceId }` |
| `code.result` | `{ runId, mode: "sample" \| "custom", status: "OK" \| "COMPILE_ERROR" \| "RUNTIME_ERROR" \| "TIME_LIMIT" \| "EXECUTOR_UNAVAILABLE", tests?: [{ id, passed, actual, expected, timeMs }], output?: { stdout, stderr, timeMs } }` |
| `session.evaluation` | xem mục 7 |
| `error` | `{ code, message, retryable }` |

**Test ẩn không gửi kết quả về frontend trong lúc phỏng vấn** — chỉ Qwen biết (để đưa test phản chứng) và chỉ xuất hiện trong bản nhận xét cuối. Lý do: chặng 4 đánh giá khả năng *tự* kiểm thử.

### 4.3. Ngắt lời (barge-in)
1. Frontend đang phát audio AI mà VAD phát hiện ứng viên nói → **tắt loa ngay tại chỗ**, gửi `speech.start`.
2. Backend nhận `speech.start` khi `aiStatus` là `speaking` hoặc `thinking` → hủy lượt đang chạy (AbortController: dừng gọi Qwen/viXTTS, bỏ audio chưa gửi), gửi `ai.speech.cancelled`.
3. Lượt bị hủy được ghi `interrupted: true` cùng phần câu đã gửi; lượt kế tiếp prompt cho Qwen biết mình bị ngắt ở đâu.

---

## 5. Điều phối lượt (EventRouter + TurnRunner)

### 5.1. Trigger gọi Qwen

| Trigger | Gọi Qwen |
|---|---|
| `speech.end` có transcript khác rỗng | ✅ `utterance` |
| có kết quả `code.run` | ✅ `code_result` |
| `whiteboard.done` | ✅ `whiteboard_done` |
| chuyển chặng (mọi nguyên nhân) | ✅ `stage_enter` — AI nói câu mở đầu chặng mới |
| im lặng quá ngưỡng | ✅ `silence` |
| đạt 80% thời gian tối đa | ✅ `time_warning` |
| `editor.update`, `whiteboard.update` | ❌ chỉ cập nhật snapshot, reset bộ đếm im lặng |
| `speech.pause` | ❌ chỉ chạy Whisper trước |

**Bộ đếm im lặng:** reset khi có `speech.start`, `editor.update`, `whiteboard.update`, `code.run`, hoặc khi AI nói xong. Không đếm khi AI đang `thinking`/`speaking`. Sau khi trigger `silence`, **không trigger lại** cho tới khi có hoạt động mới của ứng viên (tránh AI nhắc liên tục).

### 5.2. Hàng đợi theo phiên
- Mỗi phiên chỉ chạy **một lượt Qwen** tại một thời điểm.
- Trigger đến khi đang có lượt chạy: nếu là `speech.start` → hủy lượt (mục 4.3); các trigger khác được xếp hàng và **gộp** thành một lượt kế tiếp (ví dụ `code_result` + `utterance` → một lần gọi Qwen có cả hai thông tin).

### 5.3. Một lượt thoại
```
speech.end → (dùng kết quả Whisper chạy trước nếu audio không đổi, ngược lại gọi Whisper)
  → transcript.user
  → PromptBuilder dựng prompt → Qwen → LlmOutputParser
  → áp dụng action (StageMachine) → ghi note
  → nếu có reply: ai.reply → tách câu → viXTTS từng câu → ai.speech.start / nhị phân / ai.speech.end
  → ghi TURN + metrics
```
Audio gửi Whisper: gom PCM của lượt nói, đóng gói WAV. viXTTS tổng hợp **từng câu** và gửi ngay câu đầu tiên để giảm thời gian chờ nghe thấy tiếng.

### 5.4. Prompt cho Qwen
Gồm: vai trò (Tech Lead phỏng vấn, nói tiếng Việt, ngắn gọn, không đưa lời giải); đề bài + `hidden_constraints` + danh sách ràng buộc đã tiết lộ; `follow_up_topics` + chủ đề đã hỏi; chặng hiện tại, mục tiêu chặng, thời gian đã dùng so với tối thiểu/tối đa; 20 lượt thoại gần nhất; các `note` đã ghi; code mới nhất; sơ đồ whiteboard mới nhất (nếu chặng dùng); kết quả chạy gần nhất và kết quả test ẩn (chặng 4); trigger của lượt này.

### 5.5. Đầu ra của Qwen
```json
{
  "action": "speak" | "listen" | "next_stage" | "end",
  "reply": "string (rỗng khi listen)",
  "note": "string | null — ghi chú ẩn cho bản nhận xét",
  "revealed_constraints": ["chỉ số của hidden_constraints vừa tiết lộ"],
  "covered_topics": ["chỉ số của follow_up_topics vừa hỏi"]
}
```
- Nếu container hỗ trợ ràng buộc JSON (guided decoding) thì bật; không thì dùng parser.
- Parse lỗi → gọi lại 1 lần kèm yêu cầu sửa định dạng → vẫn lỗi → coi toàn bộ văn bản là `reply` với `action: "speak"`, ghi metrics `llm_json_invalid`.
- `next_stage` kèm `reply` → nói `reply` rồi mới chuyển chặng. `end` chỉ hợp lệ ở chặng 6.

---

## 6. Agents

```ts
interface LlmAgent     { chat(messages: ChatMessage[], opts: { signal, maxTokens, json: boolean }): Promise<string> }
interface SttAgent     { transcribe(wav: Buffer, opts: { signal, language: "vi" }): Promise<string> }
interface TtsAgent     { synthesize(text: string, opts: { signal }): Promise<Buffer /* PCM16 24kHz */> }
interface CodeExecutor { run(req: { language, code, stdin, expectedOutput?, signal }): Promise<ExecutionResult> }
interface ModelHealth  { check(): Promise<{ qwen: boolean, stt: boolean, tts: boolean }> }
```

| Impl | Gọi tới | Timeout | Retry |
|---|---|---|---|
| `SageMakerQwenAgent` | `InvokeEndpoint` endpoint LMI/vLLM (API dạng chat) | 15s | 1 |
| `SageMakerWhisperAgent` | `InvokeEndpoint` với `InferenceComponentName` | 10s | 1 |
| `SageMakerViXttsAgent` | `InvokeEndpoint` với `InferenceComponentName` | 10s/câu | 1 |
| `Judge0Executor` | `POST /submissions?wait=true` | 15s | 0 |
| `Fake*` | trong bộ nhớ, dùng cho unit test | — | — |

Judge0: giới hạn CPU 2s, bộ nhớ 256 MB, không mạng. So khớp output sau khi bỏ khoảng trắng cuối dòng.

---

## 7. Bản nhận xét cuối buổi

Tạo bởi một lần gọi Qwen riêng (timeout 60s, retry 1) với đầu vào: toàn bộ transcript, tất cả `note`, code cuối, sơ đồ cuối, lịch sử chạy code, kết quả test ẩn trên code cuối, số liệu khách quan.

```json
{
  "pillars": {
    "problem_solving":   { "strengths": ["..."], "improvements": ["..."] },
    "code_quality":      { "strengths": [], "improvements": [] },
    "testing_debugging": { "strengths": [], "improvements": [] },
    "communication":     { "strengths": [], "improvements": [] }
  },
  "objective": {
    "hidden_tests_passed": 7, "hidden_tests_total": 10,
    "constraints_clarified": 2, "constraints_total": 4,
    "hints_given": 2, "code_runs": 5, "interruptions": 1,
    "stage_durations_sec": { "1": 70, "2": 410, "3": 1080, "4": 300, "5": 540, "6": 120 },
    "forced_transitions": [3]
  },
  "summary": "..."
}
```
Không có điểm số. Số liệu `objective` do backend tính, không do Qwen. Nếu Qwen lỗi, bản nhận xét vẫn được lưu với `pillars: null` và `objective` đầy đủ.

Bốn trụ cột: (1) giải quyết vấn đề — làm rõ đề, giải thuật, Big-O; (2) chất lượng mã nguồn; (3) kiểm thử & gỡ lỗi; (4) giao tiếp & tư duy mở rộng.

---

## 8. Lưu trữ (DynamoDB)

### 8.1. `Problems` (có sẵn)
Thêm trường tùy chọn `hidden_constraints: L<S>`, `follow_up_topics: L<S>`. Không đổi khóa hay GSI. Cập nhật `database/setup-dynamodb.sh`, `dynamodb-tables.json`, `README-DYNAMODB.md`: bổ sung 2 trường cho Two Sum và Valid Palindrome, mỗi đề có ít nhất 5 test ẩn.

### 8.2. `InterviewSessions` (mới)
PK `session_id` (S), SK `sk` (S), `PAY_PER_REQUEST`.

| sk | Thuộc tính chính | Ghi khi |
|---|---|---|
| `META` | `problem_id, language, user_id?, token_hash, status, current_stage, started_at, ended_at?, model_versions` | tạo phiên, chuyển chặng, kết thúc |
| `TURN#<iso>#<seq>` | `role, stage, trigger, text, action?, note?, interrupted, latency_ms: {stt, llm, tts_first_audio, tts_total}, error?` | sau mỗi lượt |
| `CODE#<iso>` | `stage, code, language` | mỗi `code.run` và khi kết thúc chặng 3, 4 |
| `RUN#<iso>` | `stage, mode, custom_input?, status, tests, hidden_passed?, hidden_total?` | mỗi lần chạy |
| `BOARD#<stage>` | `nodes, edges` | `whiteboard.done` và khi kết thúc chặng 2, 5 |
| `EVAL` | bản nhận xét mục 7 | cuối buổi |

GSI `user-sessions-index`: `user_id` (HASH) + `started_at` (RANGE), sparse.
Token lưu dạng SHA-256, không lưu bản rõ. Không lưu audio.

---

## 9. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| Model chưa `InService` khi tạo phiên | `503 MODELS_NOT_READY` |
| Qwen timeout/lỗi sau retry | AI nói câu dự phòng cố định "Bạn cho mình vài giây nhé" (không qua Qwen), gửi `error` `LLM_UNAVAILABLE retryable: true`, trigger được thử lại ở sự kiện kế tiếp |
| Qwen trả JSON sai | mục 5.5 |
| Whisper lỗi | AI nói câu cố định "Mình chưa nghe rõ, bạn nói lại giúp mình nhé" |
| viXTTS lỗi | vẫn gửi `ai.reply` dạng chữ, bỏ audio, `error` `TTS_UNAVAILABLE` |
| Judge0 lỗi | `code.result` `EXECUTOR_UNAVAILABLE`; điều kiện "đã chạy code" của chặng 3 vẫn tính là thỏa |
| Lỗi ghi DynamoDB | log + metrics, thử lại 3 lần có backoff, **không** dừng buổi phỏng vấn |
| Mất kết nối WS | giữ phiên trong RAM 2 phút (dừng bộ đếm im lặng, **đồng hồ chặng vẫn chạy**); kết nối lại cùng token → gửi lại `session.state`; quá 2 phút → `abandoned`, vẫn tạo bản nhận xét |
| Backend khởi động lại | phiên đang chạy mất; META còn `active` được đánh dấu `abandoned` khi khởi động |

Câu dự phòng cố định được tổng hợp sẵn bằng viXTTS lúc khởi động và cache; nếu viXTTS cũng lỗi thì chỉ gửi chữ.

---

## 10. Hạ tầng AWS

### 10.1. SageMaker
| Model | Instance | Container | Ghi chú |
|---|---|---|---|
| `Qwen/Qwen2.5-Coder-7B-Instruct` | `ml.g5.xlarge` | AWS LMI (vLLM) | bf16, max context 8k |
| `openai/whisper-large-v3-turbo` | `ml.g4dn.xlarge` (Inference Component) | Hugging Face PyTorch DLC | ngôn ngữ cố định `vi` |
| `capleaf/viXTTS` | cùng instance trên (Inference Component) | PyTorch DLC + `inference.py` tự viết dùng `coqui-tts` | giọng mẫu cố định lưu trong model artifact; giấy phép Coqui Public Model License — **chỉ phi thương mại** |

Script Python trong `infra/sagemaker/`: `deploy.py`, `teardown.py`, `status.py`, thư mục `vixtts/` (code inference + requirements). Tên endpoint/component cấu hình qua biến môi trường, dùng chung với backend.
Không bật auto-scaling; bật/tắt thủ công. Region mặc định `ap-southeast-1`, cấu hình được.

**Điều kiện tiên quyết:** xin Service Quotas `ml.g5.xlarge for endpoint usage` = 1 và `ml.g4dn.xlarge for endpoint usage` = 1.
Chi phí ước tính khi bật cả hai: khoảng $2–2,5/giờ (cần kiểm tra lại theo region).

### 10.2. EC2 (backend + Judge0)
- `t3.medium`, Ubuntu 22.04. `infra/judge0/`: `docker-compose.yml` (Judge0 CE), `setup-ec2.sh` (cài docker, bật cgroup v1 bằng `systemd.unified_cgroup_hierarchy=0`, cài Caddy làm HTTPS reverse proxy).
- Judge0 chỉ lắng nghe `127.0.0.1`. Security group chỉ mở 443.
- IAM role: `sagemaker:InvokeEndpoint`, `sagemaker:DescribeEndpoint`, `sagemaker:DescribeInferenceComponent`, DynamoDB CRUD trên 2 bảng.

### 10.3. Biến môi trường (`.env.example`)
```
AWS_REGION=ap-southeast-1
SM_QWEN_ENDPOINT=
SM_SPEECH_ENDPOINT=
SM_STT_COMPONENT=
SM_TTS_COMPONENT=
JUDGE0_URL=http://127.0.0.1:2358
DDB_PROBLEMS_TABLE=Problems
DDB_SESSIONS_TABLE=InterviewSessions
DDB_ENDPOINT=               # để trống trên AWS; http://localhost:8000 khi dùng DynamoDB Local
MAX_CONCURRENT_SESSIONS=2
PORT=3000
```

---

## 11. Kiểm thử

| Mức | Công cụ | Nội dung | Cần AWS |
|---|---|---|---|
| Unit | vitest, đồng hồ giả, agent giả | StageMachine (điều kiện cứng, chuyển sớm, bắt buộc ở mức tối đa, 80%), EventRouter (ngưỡng theo chặng, không trigger lặp, gộp trigger, hủy khi ngắt lời), schema protocol, LlmOutputParser (JSON sai, retry, fallback), PromptBuilder (không lộ dữ liệu sai chặng), tính `objective` | ❌ |
| Tích hợp | docker compose: DynamoDB Local + Judge0 | InterviewRepository, ProblemRepository, Judge0Executor (đúng/sai/lỗi biên dịch/quá giờ), WS end-to-end với agent giả | ❌ |
| Live | `npm run test:live` (chỉ chạy khi có `LIVE=1`) | gọi mỗi endpoint 1 lần, kiểm tra định dạng, in độ trễ | ✅ |
| Mô phỏng | `npm run simulate -- --problem prob_1` | kết nối WS, phát file WAV mẫu, gửi code và sơ đồ mẫu qua đủ 6 chặng (thời lượng chặng rút gọn bằng biến môi trường), in transcript + độ trễ | ✅ |
| Thủ công | trang `/interview-test` | nút mic (VAD trình duyệt), ô code, ô sơ đồ JSON, nút chạy thử / xong chặng / kết thúc, hiển thị transcript và trạng thái | ✅ |

**Số liệu đánh giá model gốc** (trả trong `GET /api/interview/sessions/:id` → `metrics`): độ trễ trung vị và p95 cho Whisper / Qwen / viXTTS (âm thanh đầu tiên) / tổng một lượt; tỷ lệ JSON hợp lệ; tỷ lệ lỗi theo agent; số lần gợi ý, số lần bị ngắt lời.

---

## 12. Khác biệt so với tài liệu kiến trúc gốc

| Tài liệu gốc | Spec này | Lý do |
|---|---|---|
| 4 WebSocket riêng + `POST submit-code` | 1 WebSocket, phân biệt bằng `type` | giữ thứ tự sự kiện, dễ xác thực và kết nối lại |
| Orchestrator + Question Agent gọi riêng | 1 lần gọi Qwen trả JSON; chuyển chặng do StageMachine | giảm độ trễ, kiểm soát được luồng |
| Scoring Agent, JSON rubric có điểm | nhận xét định tính 4 trụ cột + số liệu khách quan | chưa có barem |
| Redis | trạng thái trong RAM + DynamoDB | 1-1, số phiên nhỏ, tiết kiệm chi phí |
| Multi-Model Endpoint gộp STT + TTS | Inference Components | MME không gộp được 2 container khác nhau |
| Scale-to-zero, cold start vài chục giây | bật/tắt thủ công | model 7B khởi động mất vài phút |
| Lambda + Docker/Judge0 | Judge0 CE trên EC2 | Lambda không chạy Docker bên trong |
| VAD ở backend, barge-in chưa có giải pháp | VAD ở frontend, tắt loa tại chỗ + hủy lượt ở backend | ngắt lời tức thì |
| Idle 45s chỉ cho editor | ngưỡng im lặng theo chặng 10–45s, tính cả nói/gõ/vẽ | một cơ chế thống nhất |
| Model fine-tune | model gốc | bản test để lấy số liệu trước |
| Input chặng 6: bản ghi âm | transcript chữ | không lưu audio |

---

## 13. Rủi ro

1. **Qwen2.5-Coder-7B bản gốc yếu tiếng Việt** — phản hồi có thể cứng hoặc lẫn tiếng Anh. Đây là điều bản test cần đo.
2. **Quota GPU** có thể mất vài ngày để duyệt — cần xin trước khi chạy live.
3. **viXTTS** không có container dựng sẵn; phụ thuộc phiên bản `coqui-tts` và PyTorch trong DLC. Là phần hạ tầng rủi ro nhất, làm và test sớm.
4. **Độ trễ tổng một lượt** ước tính 2–4 giây sau khi ứng viên nói xong (chưa tính ngưỡng im lặng) — cần đo thực tế.
5. **Judge0 cần cgroup v1** — script cài đặt xử lý, nhưng phụ thuộc AMI.
6. Region của bảng `Problems` hiện mặc định `us-east-1` — team cần thống nhất region chung.
