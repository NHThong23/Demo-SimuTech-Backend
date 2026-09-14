# AI Interviewer — Core Module (fake agents + Judge0 thật) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây xong toàn bộ backend module AI Interviewer (WebSocket + REST, 6 chặng, event router, turn runner, chấm test bằng Judge0 thật, lưu DynamoDB, trang test tối giản, script mô phỏng) chạy được và test được đầy đủ **không cần AWS SageMaker** — 3 agent AI (Qwen/Whisper/viXTTS) dùng bản giả lập (fake) đứng sau interface cố định, để plan sau chỉ cần thay bằng agent thật.

**Architecture:** Next.js custom server (`server.ts`) bọc route handler REST của Next và một `WebSocketServer` xử lý `/ws/session/:id`. Logic nghiệp vụ nằm thuần trong `src/interview/` (không phụ thuộc Next), chia theo trách nhiệm: `protocol` (schema message), `session` (state + đồng hồ + máy trạng thái 6 chặng), `router` (quyết định khi nào gọi AI), `turn` (dựng prompt, gọi LLM, phát TTS), `agents` (interface gọi model + bản giả + Judge0 thật), `persistence` (DynamoDB), `evaluation`, `metrics`. `runtime.ts` là nơi lắp ráp singleton dùng chung giữa REST và WS.

**Tech Stack:** Next.js 16 (custom server), TypeScript, `ws`, `zod`, `vitest` + `tsx`, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, Judge0 CE (Docker), DynamoDB Local (Docker) cho test tích hợp.

**Spec:** `docs/superpowers/specs/2026-09-14-ai-interviewer-module-design.md`

## Global Constraints

- Ngôn ngữ hỗ trợ chấm code: `python`, `javascript`, `cpp` (spec §4.1).
- Ngưỡng im lặng theo chặng nằm trong khoảng 5–45 giây, cấu hình tại một chỗ duy nhất (spec §3.1).
- 1 phiên chỉ 1 kết nối WS đang mở; kết nối mới thay kết nối cũ (spec §4.2).
- Tin nhắn WS ≤ 1 MB; code ≤ 64 KB; whiteboard ≤ 200 node / 400 edge (spec §4.2).
- Không lộ `hidden_constraints`, `follow_up_topics`, hay kết quả test ẩn cho frontend trong lúc phỏng vấn (spec §3.3, §4.2).
- Không chấm điểm số — chỉ nhận xét định tính theo 4 trụ cột (spec §7).
- Không lưu file ghi âm, chỉ lưu transcript chữ (spec §8.2).
- Mỗi lượt Qwen phải trả JSON đúng schema `LlmTurnOutput`; sai định dạng thì retry 1 lần rồi fallback (spec §5.5).
- Mọi commit đều kết thúc bằng dòng attribution được nêu trong hệ thống (Co-Authored-By + Claude-Session).

---

## Kiểu dữ liệu dùng chung (khóa cho toàn bộ plan)

Các task sau đều import từ hai file này — tên và shape phải khớp tuyệt đối, không được đổi giữa chừng.

```ts
// src/interview/domain/types.ts
export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type Language = "python" | "javascript" | "cpp";
export type AiStatus = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export type SessionStatus = "active" | "completed" | "abandoned";
export type TriggerType = "utterance" | "code_result" | "whiteboard_done" | "stage_enter" | "silence" | "time_warning";
export type LlmAction = "speak" | "listen" | "next_stage" | "end";
export type ExecStatus = "OK" | "COMPILE_ERROR" | "RUNTIME_ERROR" | "TIME_LIMIT" | "EXECUTOR_UNAVAILABLE";

export interface StageConfig {
  index: Stage;
  name: string;
  minSec: number;
  maxSec: number;
  silenceThresholdSec: number;
  channels: Array<"voice" | "editor" | "whiteboard">;
}

export interface TestCase { id: number; input: string; output: string; is_sample: boolean; }

export interface Problem {
  problem_id: string;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  starter_code: string;
  test_cases: TestCase[];
  hidden_constraints?: string[];
  follow_up_topics?: string[];
}

export interface WhiteboardNode { id: string; label: string; x: number; y: number; }
export interface WhiteboardEdge { from: string; to: string; label?: string; }
export interface WhiteboardState { nodes: WhiteboardNode[]; edges: WhiteboardEdge[]; }

export interface Turn {
  turnId: string;
  role: "user" | "ai";
  stage: Stage;
  trigger: TriggerType;
  text: string;
  action?: LlmAction;
  note?: string;
  interrupted: boolean;
  createdAt: string;
  latencyMs?: { stt?: number; llm?: number; ttsFirstAudio?: number; ttsTotal?: number };
  error?: string;
}

export interface LlmTurnOutput {
  action: LlmAction;
  reply: string;
  note: string | null;
  revealed_constraints: number[];
  covered_topics: number[];
}

export interface TestResultItem { id: number; passed: boolean; actual: string; expected: string; timeMs: number; }

export interface CodeRunResult {
  runId: string;
  mode: "sample" | "custom";
  status: ExecStatus;
  tests?: TestResultItem[];
  output?: { stdout: string; stderr: string; timeMs: number };
}

export interface EvaluationPillar { strengths: string[]; improvements: string[]; }
export interface EvaluationResult {
  pillars: {
    problem_solving: EvaluationPillar;
    code_quality: EvaluationPillar;
    testing_debugging: EvaluationPillar;
    communication: EvaluationPillar;
  } | null;
  objective: {
    hidden_tests_passed: number;
    hidden_tests_total: number;
    constraints_clarified: number;
    constraints_total: number;
    hints_given: number;
    code_runs: number;
    interruptions: number;
    stage_durations_sec: Record<string, number>;
    forced_transitions: Stage[];
  };
  summary: string;
}

export interface SessionMetaItem {
  session_id: string;
  sk: "META";
  problem_id: string;
  language: Language;
  user_id?: string;
  token_hash: string;
  status: SessionStatus;
  current_stage: Stage;
  started_at: string;
  ended_at?: string;
  model_versions: { qwen: string; stt: string; tts: string };
}
```

```ts
// src/interview/agents/types.ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

export interface LlmAgent {
  chat(messages: ChatMessage[], opts: { signal: AbortSignal; maxTokens: number; json: boolean }): Promise<string>;
}
export interface SttAgent {
  transcribe(wav: Buffer, opts: { signal: AbortSignal; language: "vi" }): Promise<string>;
}
export interface TtsAgent {
  synthesize(text: string, opts: { signal: AbortSignal }): Promise<Buffer>;
}
export interface ModelHealth {
  check(): Promise<{ qwen: boolean; stt: boolean; tts: boolean }>;
}
export interface ExecutionResult {
  status: ExecStatus;
  stdout: string;
  stderr: string;
  timeMs: number;
  passed?: boolean;
}
export interface CodeExecutor {
  run(req: { language: Language; code: string; stdin: string; expectedOutput?: string; signal: AbortSignal }): Promise<ExecutionResult>;
}
```

(`Language`, `ExecStatus` import từ `../domain/types`.)

---

### Task 1: Cài công cụ (deps, vitest, script)

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: lệnh `npm test`, `npm run test:watch`, `npm run simulate` chạy được (dùng ở mọi task sau).

- [ ] **Step 1: Cài dependency**

```bash
npm install ws zod @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
npm install -D vitest tsx @types/ws aws-sdk-client-mock
```

- [ ] **Step 2: Tạo `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Sửa `package.json` scripts**

```json
{
  "scripts": {
    "dev": "tsx watch server.ts",
    "build": "next build",
    "start": "NODE_ENV=production tsx server.ts",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "simulate": "tsx scripts/simulate-interview.ts"
  }
}
```

- [ ] **Step 4: Tạo `.env.example`**

```
AWS_REGION=ap-southeast-1
DDB_PROBLEMS_TABLE=Problems
DDB_SESSIONS_TABLE=InterviewSessions
DDB_ENDPOINT=http://localhost:8000
JUDGE0_URL=http://127.0.0.1:2358
MAX_CONCURRENT_SESSIONS=2
PORT=3000
USE_FAKE_AGENTS=true
```

- [ ] **Step 5: Xác nhận `npm test` chạy được (chưa có test nào cũng phải không lỗi cấu hình)**

Run: `npm test`
Expected: `No test files found` (không lỗi cấu hình vitest) — đây là kết quả đúng ở bước này.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .env.example
git commit -m "chore: add test tooling and env template for interview module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 2: Domain types + giao thức WS/REST (zod)

**Files:**
- Create: `src/interview/domain/types.ts`
- Create: `src/interview/protocol/messages.ts`
- Create: `src/interview/protocol/messages.test.ts`

**Interfaces:**
- Consumes: không có (task nền tảng).
- Produces: toàn bộ type ở phần "Kiểu dữ liệu dùng chung" phía trên; `ClientMessageSchema`, `ClientMessage`, `ServerMessage` (union type), hàm dựng message `buildServerMessage(...)` — dùng ở Task 17 (WS gateway).

- [ ] **Step 1: Tạo `src/interview/domain/types.ts`**

Copy nguyên văn nội dung ở mục "Kiểu dữ liệu dùng chung" phía trên vào file này.

- [ ] **Step 2: Viết test cho protocol trước (`messages.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { ClientMessageSchema } from "./messages";

describe("ClientMessageSchema", () => {
  it("accepts speech.start with no data", () => {
    const r = ClientMessageSchema.safeParse({ type: "speech.start" });
    expect(r.success).toBe(true);
  });

  it("accepts editor.update with code + language", () => {
    const r = ClientMessageSchema.safeParse({
      type: "editor.update",
      data: { code: "def f(): pass", language: "python" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects editor.update with invalid language", () => {
    const r = ClientMessageSchema.safeParse({
      type: "editor.update",
      data: { code: "x", language: "rust" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects code larger than 64KB", () => {
    const r = ClientMessageSchema.safeParse({
      type: "editor.update",
      data: { code: "a".repeat(65537), language: "python" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts code.run without data", () => {
    const r = ClientMessageSchema.safeParse({ type: "code.run" });
    expect(r.success).toBe(true);
  });

  it("accepts code.run with customInput", () => {
    const r = ClientMessageSchema.safeParse({ type: "code.run", data: { customInput: "1 2" } });
    expect(r.success).toBe(true);
  });

  it("accepts whiteboard.update within node/edge limits", () => {
    const r = ClientMessageSchema.safeParse({
      type: "whiteboard.update",
      data: { nodes: [{ id: "n1", label: "a", x: 0, y: 0 }], edges: [] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects whiteboard.update over 200 nodes", () => {
    const nodes = Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, label: "a", x: 0, y: 0 }));
    const r = ClientMessageSchema.safeParse({ type: "whiteboard.update", data: { nodes, edges: [] } });
    expect(r.success).toBe(false);
  });

  it("rejects unknown type", () => {
    const r = ClientMessageSchema.safeParse({ type: "not.a.type" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail vì `messages.ts` chưa tồn tại**

Run: `npm test -- messages`
Expected: FAIL — `Cannot find module './messages'`

- [ ] **Step 4: Viết `src/interview/protocol/messages.ts`**

```ts
import { z } from "zod";
import type { Language } from "../domain/types";

const LanguageSchema = z.enum(["python", "javascript", "cpp"]) satisfies z.ZodType<Language>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speech.start") }),
  z.object({ type: z.literal("speech.pause") }),
  z.object({ type: z.literal("speech.end") }),
  z.object({
    type: z.literal("editor.update"),
    data: z.object({ code: z.string().max(65536), language: LanguageSchema }),
  }),
  z.object({
    type: z.literal("code.run"),
    data: z.object({ customInput: z.string().max(65536).optional() }).optional(),
  }),
  z.object({
    type: z.literal("whiteboard.update"),
    data: z.object({
      nodes: z
        .array(z.object({ id: z.string(), label: z.string(), x: z.number(), y: z.number() }))
        .max(200),
      edges: z
        .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() }))
        .max(400),
    }),
  }),
  z.object({ type: z.literal("whiteboard.done") }),
  z.object({ type: z.literal("stage.done") }),
  z.object({ type: z.literal("session.end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | {
      type: "session.state";
      data: {
        stage: number;
        stageName: string;
        stageElapsedSec: number;
        stageMinSec: number;
        stageMaxSec: number;
        silenceThresholdSec: number;
        aiStatus: "idle" | "listening" | "transcribing" | "thinking" | "speaking";
        status: "active" | "completed" | "abandoned";
      };
    }
  | { type: "transcript.user"; data: { utteranceId: string; text: string } }
  | { type: "ai.reply"; data: { utteranceId: string; text: string } }
  | { type: "ai.speech.start"; data: { utteranceId: string; sampleRate: 24000; format: "pcm16" } }
  | { type: "ai.speech.end"; data: { utteranceId: string } }
  | { type: "ai.speech.cancelled"; data: { utteranceId: string } }
  | {
      type: "code.result";
      data: {
        runId: string;
        mode: "sample" | "custom";
        status: string;
        tests?: unknown[];
        output?: { stdout: string; stderr: string; timeMs: number };
      };
    }
  | { type: "session.evaluation"; data: unknown }
  | { type: "error"; data: { code: string; message: string; retryable: boolean } };

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClientMessage(raw: string): { ok: true; value: ClientMessage } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  const result = ClientMessageSchema.safeParse(data);
  if (!result.success) return { ok: false, error: "INVALID_MESSAGE" };
  return { ok: true, value: result.data };
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npm test -- messages`
Expected: PASS (9 test)

- [ ] **Step 6: Commit**

```bash
git add src/interview/domain/types.ts src/interview/protocol/messages.ts src/interview/protocol/messages.test.ts
git commit -m "feat(interview): add domain types and WS/REST protocol schemas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 3: Cấu hình 6 chặng + đồng hồ (Clock)

**Files:**
- Create: `src/interview/config/stages.ts`
- Create: `src/interview/config/stages.test.ts`
- Create: `src/interview/session/clock.ts`
- Create: `src/interview/session/clock.test.ts`

**Interfaces:**
- Consumes: `StageConfig`, `Stage` từ `../domain/types`.
- Produces: `STAGE_CONFIG: StageConfig[]`, `getStageConfig(stage: Stage): StageConfig` — dùng ở Task 4, 5, 8. `Clock` interface, `SystemClock`, `FakeClock` (có `advance(ms)`) — dùng ở Task 5, 8, 10.

- [ ] **Step 1: Viết test cấu hình chặng**

```ts
// src/interview/config/stages.test.ts
import { describe, it, expect } from "vitest";
import { STAGE_CONFIG, getStageConfig } from "./stages";

describe("STAGE_CONFIG", () => {
  it("có đúng 6 chặng, đánh số 1..6 liên tục", () => {
    expect(STAGE_CONFIG.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("mọi ngưỡng im lặng nằm trong khoảng 5-45 giây", () => {
    for (const s of STAGE_CONFIG) {
      expect(s.silenceThresholdSec).toBeGreaterThanOrEqual(5);
      expect(s.silenceThresholdSec).toBeLessThanOrEqual(45);
    }
  });

  it("minSec luôn <= maxSec", () => {
    for (const s of STAGE_CONFIG) expect(s.minSec).toBeLessThanOrEqual(s.maxSec);
  });

  it("chặng 3 (viết mã) có ngưỡng im lặng 45s và kênh editor", () => {
    const s = getStageConfig(3);
    expect(s.silenceThresholdSec).toBe(45);
    expect(s.channels).toContain("editor");
  });

  it("chặng 5 có kênh whiteboard", () => {
    expect(getStageConfig(5).channels).toContain("whiteboard");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- stages`
Expected: FAIL — module `./stages` không tồn tại

- [ ] **Step 3: Viết `src/interview/config/stages.ts`**

```ts
import type { Stage, StageConfig } from "../domain/types";

export const STAGE_CONFIG: StageConfig[] = [
  { index: 1, name: "Làm rõ yêu cầu", minSec: 180, maxSec: 300, silenceThresholdSec: 10, channels: ["voice"] },
  { index: 2, name: "Thảo luận giải thuật", minSec: 300, maxSec: 600, silenceThresholdSec: 20, channels: ["voice", "whiteboard"] },
  { index: 3, name: "Viết mã", minSec: 900, maxSec: 1500, silenceThresholdSec: 45, channels: ["voice", "editor"] },
  { index: 4, name: "Tự kiểm thử & gỡ lỗi", minSec: 300, maxSec: 600, silenceThresholdSec: 20, channels: ["voice", "editor"] },
  { index: 5, name: "Mở rộng & phản biện", minSec: 300, maxSec: 600, silenceThresholdSec: 20, channels: ["voice", "whiteboard"] },
  { index: 6, name: "Đánh giá & wrap-up", minSec: 0, maxSec: 300, silenceThresholdSec: 10, channels: ["voice"] },
];

export function getStageConfig(stage: Stage): StageConfig {
  const config = STAGE_CONFIG.find((s) => s.index === stage);
  if (!config) throw new Error(`Unknown stage: ${stage}`);
  return config;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- stages`
Expected: PASS (5 test)

- [ ] **Step 5: Viết test cho Clock**

```ts
// src/interview/session/clock.test.ts
import { describe, it, expect, vi } from "vitest";
import { FakeClock } from "./clock";

describe("FakeClock", () => {
  it("now() bắt đầu từ 0 và tăng khi advance", () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(0);
    clock.advance(1000);
    expect(clock.now()).toBe(1000);
  });

  it("fire timer đúng lúc khi advance đủ", () => {
    const clock = new FakeClock();
    const fn = vi.fn();
    clock.setTimeout(fn, 500);
    clock.advance(499);
    expect(fn).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("không fire timer đã bị clearTimeout", () => {
    const clock = new FakeClock();
    const fn = vi.fn();
    const t = clock.setTimeout(fn, 500);
    clock.clearTimeout(t);
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("timer đặt ra trong lúc đang fire timer khác vẫn được chạy nếu tới hạn cùng lượt advance", () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push("first");
      clock.setTimeout(() => order.push("second"), 0);
    }, 100);
    clock.advance(100);
    expect(order).toEqual(["first", "second"]);
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận fail**

Run: `npm test -- clock`
Expected: FAIL — module `./clock` không tồn tại

- [ ] **Step 7: Viết `src/interview/session/clock.ts`**

```ts
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(fn: () => void, ms: number): unknown {
    return setTimeout(fn, ms);
  }
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout);
  }
}

interface FakeTimer { id: number; at: number; fn: () => void; }

export class FakeClock implements Clock {
  private currentMs = 0;
  private timers: FakeTimer[] = [];
  private nextId = 1;

  now(): number {
    return this.currentMs;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.currentMs + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  /** Tua đồng hồ tới, chạy mọi timer đến hạn (kể cả timer mới đặt ra trong lúc chạy). */
  advance(ms: number): void {
    this.currentMs += ms;
    let fired = true;
    while (fired) {
      fired = false;
      const due = this.timers.filter((t) => t.at <= this.currentMs).sort((a, b) => a.at - b.at);
      for (const t of due) {
        this.timers = this.timers.filter((x) => x.id !== t.id);
        t.fn();
        fired = true;
      }
    }
  }
}
```

- [ ] **Step 8: Chạy test, xác nhận pass**

Run: `npm test -- clock`
Expected: PASS (4 test)

- [ ] **Step 9: Commit**

```bash
git add src/interview/config/stages.ts src/interview/config/stages.test.ts src/interview/session/clock.ts src/interview/session/clock.test.ts
git commit -m "feat(interview): add stage config and clock abstraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 4: StageMachine (logic chuyển chặng thuần)

**Files:**
- Create: `src/interview/session/stage-machine.ts`
- Create: `src/interview/session/stage-machine.test.ts`

**Interfaces:**
- Consumes: `getStageConfig` từ `../config/stages`; `Stage` từ `../domain/types`.
- Produces: `evaluateStageEvent(input, event): StageMachineResult` — dùng ở Task 6 (Session) và Task 8 (EventRouter/WsGateway orchestration).

Luật (spec §3.2, đã chỉnh theo góp ý "không chặn chuyển sớm"):
- `llm_next_stage` hoặc `stage_done_button`: nếu chặng hiện tại là 3 và `codeRunCountThisStage === 0` → từ chối (`STAGE_PRECONDITION`). Ngược lại → chuyển ngay, không cần đạt `minSec`.
- `hidden_tests_passed` (chỉ ý nghĩa ở chặng 4): nếu đang ở chặng 4 và `hiddenTestsAllPassed === true` → chuyển ngay.
- `tick`: nếu `elapsedSec >= maxSec` → **bắt buộc chuyển** (bỏ qua mọi điều kiện, kể cả chặng 3 chưa chạy code). Nếu `elapsedSec >= maxSec * 0.8` → trả `timeWarning: true` (không chuyển).
- Chặng 6 chuyển bằng `stage_done_button` (ứng viên bấm "Kết thúc") → `nextStage: null` nghĩa là kết thúc phiên, không phải lỗi.
- Không có chặng nào quay lại chặng trước — `nextStage` luôn là `currentStage + 1` hoặc `null`.

- [ ] **Step 1: Viết test**

```ts
// src/interview/session/stage-machine.test.ts
import { describe, it, expect } from "vitest";
import { evaluateStageEvent } from "./stage-machine";

describe("evaluateStageEvent", () => {
  it("chặng 1: llm_next_stage chuyển ngay dù chưa đạt minSec", () => {
    const r = evaluateStageEvent(
      { currentStage: 1, elapsedSec: 60, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "llm_next_stage" },
    );
    expect(r).toMatchObject({ transitioned: true, forced: false, nextStage: 2 });
  });

  it("chặng 3: stage_done_button bị từ chối nếu chưa chạy code lần nào", () => {
    const r = evaluateStageEvent(
      { currentStage: 3, elapsedSec: 1000, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "stage_done_button" },
    );
    expect(r.transitioned).toBe(false);
    expect(r.rejected).toMatchObject({ code: "STAGE_PRECONDITION" });
  });

  it("chặng 3: stage_done_button được chấp nhận nếu đã chạy code >= 1 lần", () => {
    const r = evaluateStageEvent(
      { currentStage: 3, elapsedSec: 1000, codeRunCountThisStage: 1, hiddenTestsAllPassed: false },
      { type: "stage_done_button" },
    );
    expect(r).toMatchObject({ transitioned: true, nextStage: 4 });
  });

  it("chặng 4: hidden_tests_passed tự động chuyển", () => {
    const r = evaluateStageEvent(
      { currentStage: 4, elapsedSec: 100, codeRunCountThisStage: 3, hiddenTestsAllPassed: true },
      { type: "hidden_tests_passed" },
    );
    expect(r).toMatchObject({ transitioned: true, nextStage: 5 });
  });

  it("chặng 4: hidden_tests_passed không có tác dụng nếu chưa pass hết", () => {
    const r = evaluateStageEvent(
      { currentStage: 4, elapsedSec: 100, codeRunCountThisStage: 3, hiddenTestsAllPassed: false },
      { type: "hidden_tests_passed" },
    );
    expect(r.transitioned).toBe(false);
  });

  it("tick: cảnh báo ở 80% maxSec, không chuyển", () => {
    // chặng 1 maxSec = 300s -> 80% = 240s
    const r = evaluateStageEvent(
      { currentStage: 1, elapsedSec: 240, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "tick" },
    );
    expect(r).toMatchObject({ transitioned: false, timeWarning: true });
  });

  it("tick: bắt buộc chuyển khi hết maxSec, kể cả chặng 3 chưa chạy code", () => {
    const r = evaluateStageEvent(
      { currentStage: 3, elapsedSec: 1500, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "tick" },
    );
    expect(r).toMatchObject({ transitioned: true, forced: true, nextStage: 4 });
  });

  it("chặng 6: stage_done_button kết thúc phiên (nextStage null)", () => {
    const r = evaluateStageEvent(
      { currentStage: 6, elapsedSec: 30, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "stage_done_button" },
    );
    expect(r).toMatchObject({ transitioned: true, nextStage: null });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- stage-machine`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 3: Viết `src/interview/session/stage-machine.ts`**

```ts
import type { Stage } from "../domain/types";
import { getStageConfig } from "../config/stages";

export interface StageMachineInput {
  currentStage: Stage;
  elapsedSec: number;
  codeRunCountThisStage: number;
  hiddenTestsAllPassed: boolean;
}

export type StageMachineEvent =
  | { type: "llm_next_stage" }
  | { type: "stage_done_button" }
  | { type: "hidden_tests_passed" }
  | { type: "tick" };

export interface StageMachineResult {
  transitioned: boolean;
  forced: boolean;
  timeWarning: boolean;
  nextStage: Stage | null;
  rejected?: { code: "STAGE_PRECONDITION"; message: string };
}

const NO_TRANSITION: StageMachineResult = { transitioned: false, forced: false, timeWarning: false, nextStage: null };

function nextStageOf(stage: Stage): Stage | null {
  return stage === 6 ? null : ((stage + 1) as Stage);
}

function checkPrecondition(input: StageMachineInput): { ok: true } | { ok: false; message: string } {
  if (input.currentStage === 3 && input.codeRunCountThisStage === 0) {
    return { ok: false, message: "Bạn cần chạy thử code ít nhất 1 lần trước khi qua chặng tiếp theo." };
  }
  return { ok: true };
}

export function evaluateStageEvent(input: StageMachineInput, event: StageMachineEvent): StageMachineResult {
  if (event.type === "tick") {
    const config = getStageConfig(input.currentStage);
    if (input.elapsedSec >= config.maxSec) {
      return { transitioned: true, forced: true, timeWarning: false, nextStage: nextStageOf(input.currentStage) };
    }
    if (input.elapsedSec >= config.maxSec * 0.8) {
      return { ...NO_TRANSITION, timeWarning: true };
    }
    return NO_TRANSITION;
  }

  if (event.type === "hidden_tests_passed") {
    if (input.currentStage === 4 && input.hiddenTestsAllPassed) {
      return { transitioned: true, forced: false, timeWarning: false, nextStage: nextStageOf(input.currentStage) };
    }
    return NO_TRANSITION;
  }

  // llm_next_stage | stage_done_button
  const precondition = checkPrecondition(input);
  if (!precondition.ok) {
    return { ...NO_TRANSITION, rejected: { code: "STAGE_PRECONDITION", message: precondition.message } };
  }
  return { transitioned: true, forced: false, timeWarning: false, nextStage: nextStageOf(input.currentStage) };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- stage-machine`
Expected: PASS (8 test)

- [ ] **Step 5: Commit**

```bash
git add src/interview/session/stage-machine.ts src/interview/session/stage-machine.test.ts
git commit -m "feat(interview): add pure stage transition machine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 5: Session + SessionManager

**Files:**
- Create: `src/interview/session/session.ts`
- Create: `src/interview/session/session-manager.ts`
- Create: `src/interview/session/session.test.ts`
- Create: `src/interview/session/session-manager.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 3), `evaluateStageEvent`/`StageMachineEvent`/`StageMachineResult` (Task 4), `getStageConfig` (Task 3), domain types (Task 2).
- Produces: `Session` class, `SessionSnapshot` type, `SessionManager` class, `TooManySessionsError` — dùng ở Task 8 (PromptBuilder), Task 9 (TurnRunner), Task 11 (Evaluation), Task 15 (runtime), Task 16 (WsGateway).

- [ ] **Step 1: Viết test cho `Session`**

```ts
// src/interview/session/session.test.ts
import { describe, it, expect } from "vitest";
import { Session } from "./session";
import { FakeClock } from "./clock";
import type { Problem } from "../domain/types";

const PROBLEM: Problem = {
  problem_id: "prob_1",
  title: "Two Sum",
  description: "desc",
  difficulty: "EASY",
  category: "Array",
  starter_code: "def two_sum(): pass",
  test_cases: [{ id: 1, input: "a", output: "b", is_sample: true }],
  hidden_constraints: ["c1", "c2"],
  follow_up_topics: ["t1"],
};

function makeSession(clock = new FakeClock()) {
  return new Session({ sessionId: "ses_1", tokenHash: "h", problem: PROBLEM, language: "python", clock });
}

describe("Session", () => {
  it("bắt đầu ở chặng 1, aiStatus idle, status active", () => {
    const s = makeSession();
    expect(s.currentStage).toBe(1);
    expect(s.status).toBe("active");
    expect(s.aiStatus).toBe("idle");
  });

  it("stageElapsedSec tăng theo Clock", () => {
    const clock = new FakeClock();
    const s = makeSession(clock);
    clock.advance(5000);
    expect(s.stageElapsedSec).toBe(5);
  });

  it("attemptTransition chuyển chặng 1 -> 2 và reset đồng hồ chặng", () => {
    const clock = new FakeClock();
    const s = makeSession(clock);
    clock.advance(10_000);
    const result = s.attemptTransition({ type: "llm_next_stage" });
    expect(result.transitioned).toBe(true);
    expect(s.currentStage).toBe(2);
    expect(s.stageElapsedSec).toBe(0);
    expect(s.stageDurationsSec["1"]).toBe(10);
  });

  it("chặng 3 từ chối stage_done_button khi chưa recordCodeRun", () => {
    const s = makeSession();
    s.currentStage = 3 as never; // dựng thẳng để test, tránh phải chuyển 2 lần
    const result = s.attemptTransition({ type: "stage_done_button" });
    expect(result.rejected?.code).toBe("STAGE_PRECONDITION");
  });

  it("recordCodeRun rồi chặng 3 mới cho chuyển, và reset đếm code run cho chặng mới", () => {
    const s = makeSession();
    (s as unknown as { currentStage: number }).currentStage = 3;
    s.recordCodeRun({ runId: "r1", mode: "sample", status: "OK", tests: [] });
    const result = s.attemptTransition({ type: "stage_done_button" });
    expect(result.transitioned).toBe(true);
    expect(s.currentStage).toBe(4);
  });

  it("forced transition qua tick được ghi vào forcedTransitions", () => {
    const clock = new FakeClock();
    const s = makeSession(clock);
    clock.advance(300_000); // đúng maxSec của chặng 1
    const result = s.attemptTransition({ type: "tick" });
    expect(result.forced).toBe(true);
    expect(s.forcedTransitions).toEqual([1]);
  });

  it("toSnapshot phản ánh đúng state hiện tại", () => {
    const s = makeSession();
    s.latestCode = "print(1)";
    const snap = s.toSnapshot();
    expect(snap.problem.problem_id).toBe("prob_1");
    expect(snap.latestCode).toBe("print(1)");
    expect(snap.stageConfig.index).toBe(1);
    expect(snap.recentTurns).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- session.test`
Expected: FAIL — module `./session` không tồn tại

- [ ] **Step 3: Viết `src/interview/session/session.ts`**

```ts
import type {
  AiStatus, CodeRunResult, Language, Problem, SessionStatus, Stage,
  StageConfig, Turn, WhiteboardState,
} from "../domain/types";
import { getStageConfig } from "../config/stages";
import type { Clock } from "./clock";
import { evaluateStageEvent, type StageMachineEvent, type StageMachineResult } from "./stage-machine";

export interface SessionOptions {
  sessionId: string;
  tokenHash: string;
  problem: Problem;
  language: Language;
  userId?: string;
  clock: Clock;
}

export interface SessionSnapshot {
  problem: Problem;
  language: Language;
  currentStage: Stage;
  stageElapsedSec: number;
  stageConfig: StageConfig;
  recentTurns: Turn[];
  latestCode: string;
  latestBoard: WhiteboardState | null;
  revealedConstraints: number[];
  coveredTopics: number[];
  lastCodeRun: CodeRunResult | null;
  hiddenTestsPassed: number;
  hiddenTestsTotal: number;
}

export class Session {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly problem: Problem;
  readonly language: Language;
  readonly userId?: string;
  status: SessionStatus = "active";
  aiStatus: AiStatus = "idle";
  currentStage: Stage = 1;
  latestCode = "";
  latestBoardByStage: Partial<Record<Stage, WhiteboardState>> = {};
  turns: Turn[] = [];
  codeRuns: CodeRunResult[] = [];
  revealedConstraints = new Set<number>();
  coveredTopics = new Set<number>();
  hintsGiven = 0;
  interruptions = 0;
  forcedTransitions: Stage[] = [];
  stageDurationsSec: Record<string, number> = {};
  hiddenTestsPassed = 0;
  hiddenTestsTotal = 0;
  currentTurnController: AbortController | null = null;

  private clock: Clock;
  private stageEnteredAtMs: number;
  private codeRunCountThisStage = 0;

  constructor(opts: SessionOptions) {
    this.sessionId = opts.sessionId;
    this.tokenHash = opts.tokenHash;
    this.problem = opts.problem;
    this.language = opts.language;
    this.userId = opts.userId;
    this.clock = opts.clock;
    this.stageEnteredAtMs = opts.clock.now();
  }

  get stageElapsedSec(): number {
    return Math.floor((this.clock.now() - this.stageEnteredAtMs) / 1000);
  }

  recordCodeRun(result: CodeRunResult): void {
    this.codeRuns.push(result);
    this.codeRunCountThisStage += 1;
  }

  recordTurn(turn: Turn): void {
    this.turns.push(turn);
    if (turn.role === "ai" && turn.action === "speak" && turn.trigger === "silence") this.hintsGiven += 1;
  }

  get recentTurns(): Turn[] {
    return this.turns.slice(-20);
  }

  markInterrupted(turnId: string): void {
    const turn = this.turns.find((t) => t.turnId === turnId);
    if (turn) turn.interrupted = true;
    this.interruptions += 1;
  }

  applyLlmReveal(output: { revealed_constraints: number[]; covered_topics: number[] }): void {
    for (const i of output.revealed_constraints) this.revealedConstraints.add(i);
    for (const i of output.covered_topics) this.coveredTopics.add(i);
  }

  updateHiddenTestProgress(passed: number, total: number): void {
    this.hiddenTestsPassed = passed;
    this.hiddenTestsTotal = total;
  }

  attemptTransition(event: StageMachineEvent): StageMachineResult {
    const result = evaluateStageEvent(
      {
        currentStage: this.currentStage,
        elapsedSec: this.stageElapsedSec,
        codeRunCountThisStage: this.codeRunCountThisStage,
        hiddenTestsAllPassed:
          this.currentStage === 4 && this.hiddenTestsTotal > 0 && this.hiddenTestsPassed === this.hiddenTestsTotal,
      },
      event,
    );
    if (result.transitioned) {
      const now = this.clock.now();
      this.stageDurationsSec[String(this.currentStage)] = Math.floor((now - this.stageEnteredAtMs) / 1000);
      if (result.forced) this.forcedTransitions.push(this.currentStage);
      if (result.nextStage === null) {
        this.status = "completed";
      } else {
        this.currentStage = result.nextStage;
        this.stageEnteredAtMs = now;
        this.codeRunCountThisStage = 0;
      }
    }
    return result;
  }

  toSnapshot(): SessionSnapshot {
    return {
      problem: this.problem,
      language: this.language,
      currentStage: this.currentStage,
      stageElapsedSec: this.stageElapsedSec,
      stageConfig: getStageConfig(this.currentStage),
      recentTurns: this.recentTurns,
      latestCode: this.latestCode,
      latestBoard: this.latestBoardByStage[this.currentStage] ?? null,
      revealedConstraints: [...this.revealedConstraints],
      coveredTopics: [...this.coveredTopics],
      lastCodeRun: this.codeRuns.at(-1) ?? null,
      hiddenTestsPassed: this.hiddenTestsPassed,
      hiddenTestsTotal: this.hiddenTestsTotal,
    };
  }
}
```

- [ ] **Step 4: Chạy test Session, xác nhận pass**

Run: `npm test -- session.test`
Expected: PASS (7 test)

- [ ] **Step 5: Viết test cho `SessionManager`**

```ts
// src/interview/session/session-manager.test.ts
import { describe, it, expect } from "vitest";
import { SessionManager, TooManySessionsError } from "./session-manager";
import { FakeClock } from "./clock";
import type { Problem } from "../domain/types";

const PROBLEM: Problem = {
  problem_id: "prob_1", title: "t", description: "d", difficulty: "EASY", category: "Array",
  starter_code: "", test_cases: [],
};

describe("SessionManager", () => {
  it("tạo và lấy lại được session theo id", () => {
    const mgr = new SessionManager({ maxConcurrent: 2 });
    const s = mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    expect(mgr.get("s1")).toBe(s);
  });

  it("ném TooManySessionsError khi vượt maxConcurrent", () => {
    const mgr = new SessionManager({ maxConcurrent: 1 });
    mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    expect(() =>
      mgr.create({ sessionId: "s2", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() }),
    ).toThrow(TooManySessionsError);
  });

  it("session đã completed không tính vào giới hạn đồng thời", () => {
    const mgr = new SessionManager({ maxConcurrent: 1 });
    const s1 = mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    s1.status = "completed";
    expect(() =>
      mgr.create({ sessionId: "s2", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() }),
    ).not.toThrow();
  });

  it("remove() xóa session khỏi manager", () => {
    const mgr = new SessionManager({ maxConcurrent: 2 });
    mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    mgr.remove("s1");
    expect(mgr.get("s1")).toBeUndefined();
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận fail rồi viết `src/interview/session/session-manager.ts`**

Run: `npm test -- session-manager` → FAIL (module chưa tồn tại)

```ts
import { Session, type SessionOptions } from "./session";

export interface SessionManagerOptions { maxConcurrent: number; }

export class TooManySessionsError extends Error {
  constructor() {
    super("TOO_MANY_SESSIONS");
    this.name = "TooManySessionsError";
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(private opts: SessionManagerOptions) {}

  create(opts: SessionOptions): Session {
    const activeCount = [...this.sessions.values()].filter((s) => s.status === "active").length;
    if (activeCount >= this.opts.maxConcurrent) throw new TooManySessionsError();
    const session = new Session(opts);
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
```

- [ ] **Step 7: Chạy cả hai file test, xác nhận pass**

Run: `npm test -- session`
Expected: PASS (11 test)

- [ ] **Step 8: Commit**

```bash
git add src/interview/session/session.ts src/interview/session/session-manager.ts src/interview/session/session.test.ts src/interview/session/session-manager.test.ts
git commit -m "feat(interview): add Session and SessionManager

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 6: Interface agent + agent giả lập + `runTestSuite`

**Files:**
- Create: `src/interview/agents/types.ts`
- Create: `src/interview/agents/fakes.ts`
- Create: `src/interview/agents/fakes.test.ts`
- Create: `src/interview/agents/code-runner.ts`
- Create: `src/interview/agents/code-runner.test.ts`

**Interfaces:**
- Consumes: `Language`, `ExecStatus` từ `../domain/types`.
- Produces: `LlmAgent`, `SttAgent`, `TtsAgent`, `ModelHealth`, `CodeExecutor`, `ExecutionResult`, `ChatMessage` (interface, xem mục "Kiểu dữ liệu dùng chung"); `FakeLlmAgent` (có `enqueue(json: string)`, `callCount`, `lastMessages`), `FakeSttAgent` (có `enqueue(text: string)`), `FakeTtsAgent`, `FakeModelHealth`, `FakeCodeExecutor` — dùng ở Task 8, 9, 11, 15, 16, 19. `runTestSuite(executor, language, code, cases, signal): Promise<TestResultItem[]>`, `TestSuiteCase` — dùng ở Task 14, 16.

- [ ] **Step 1: Viết `src/interview/agents/types.ts`**

Copy nguyên văn nội dung ở mục "Kiểu dữ liệu dùng chung" (phần `agents/types.ts`) phía đầu plan.

- [ ] **Step 2: Viết test cho các fake agent**

```ts
// src/interview/agents/fakes.test.ts
import { describe, it, expect } from "vitest";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeModelHealth, FakeCodeExecutor } from "./fakes";

describe("FakeLlmAgent", () => {
  it("trả về response đã enqueue theo thứ tự FIFO", async () => {
    const agent = new FakeLlmAgent();
    agent.enqueue('{"a":1}');
    agent.enqueue('{"a":2}');
    const signal = new AbortController().signal;
    await expect(agent.chat([], { signal, maxTokens: 10, json: true })).resolves.toBe('{"a":1}');
    await expect(agent.chat([], { signal, maxTokens: 10, json: true })).resolves.toBe('{"a":2}');
  });

  it("trả về JSON hợp lệ mặc định khi hàng đợi rỗng", async () => {
    const agent = new FakeLlmAgent();
    const raw = await agent.chat([], { signal: new AbortController().signal, maxTokens: 10, json: true });
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("ghi lại messages đã nhận cho việc assert trong test khác", async () => {
    const agent = new FakeLlmAgent();
    const messages = [{ role: "user" as const, content: "hi" }];
    await agent.chat(messages, { signal: new AbortController().signal, maxTokens: 10, json: true });
    expect(agent.callCount).toBe(1);
    expect(agent.lastMessages).toEqual(messages);
  });
});

describe("FakeSttAgent", () => {
  it("trả về transcript đã enqueue, mặc định rỗng", async () => {
    const agent = new FakeSttAgent();
    agent.enqueue("xin chào");
    const opts = { signal: new AbortController().signal, language: "vi" as const };
    await expect(agent.transcribe(Buffer.from([]), opts)).resolves.toBe("xin chào");
    await expect(agent.transcribe(Buffer.from([]), opts)).resolves.toBe("");
  });
});

describe("FakeTtsAgent", () => {
  it("trả về Buffer khác rỗng cho mọi câu", async () => {
    const agent = new FakeTtsAgent();
    const audio = await agent.synthesize("xin chào", { signal: new AbortController().signal });
    expect(audio.length).toBeGreaterThan(0);
  });
});

describe("FakeModelHealth", () => {
  it("mặc định báo cả 3 model sẵn sàng", async () => {
    const health = new FakeModelHealth();
    await expect(health.check()).resolves.toEqual({ qwen: true, stt: true, tts: true });
  });

  it("cho phép ép trạng thái không sẵn sàng để test lỗi 503", async () => {
    const health = new FakeModelHealth({ qwen: false, stt: true, tts: true });
    await expect(health.check()).resolves.toEqual({ qwen: false, stt: true, tts: true });
  });
});

describe("FakeCodeExecutor", () => {
  it("gọi hàm resultFn được truyền vào với đúng request", async () => {
    const executor = new FakeCodeExecutor((req) => ({
      status: req.stdin === "ok" ? "OK" : "RUNTIME_ERROR",
      stdout: req.stdin,
      stderr: "",
      timeMs: 5,
      passed: req.expectedOutput === req.stdin,
    }));
    const res = await executor.run({ language: "python", code: "x", stdin: "ok", expectedOutput: "ok", signal: new AbortController().signal });
    expect(res).toEqual({ status: "OK", stdout: "ok", stderr: "", timeMs: 5, passed: true });
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- fakes.test`
Expected: FAIL — module `./fakes` không tồn tại

- [ ] **Step 4: Viết `src/interview/agents/fakes.ts`**

```ts
import type { ChatMessage, CodeExecutor, ExecutionResult, LlmAgent, ModelHealth, SttAgent, TtsAgent } from "./types";
import type { Language } from "../domain/types";

export class FakeLlmAgent implements LlmAgent {
  private queue: string[] = [];
  private calls: ChatMessage[][] = [];

  enqueue(response: string): void {
    this.queue.push(response);
  }

  async chat(messages: ChatMessage[], _opts: { signal: AbortSignal; maxTokens: number; json: boolean }): Promise<string> {
    this.calls.push(messages);
    return (
      this.queue.shift() ??
      JSON.stringify({ action: "speak", reply: "OK, mình hiểu rồi.", note: null, revealed_constraints: [], covered_topics: [] })
    );
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastMessages(): ChatMessage[] | undefined {
    return this.calls.at(-1);
  }
}

export class FakeSttAgent implements SttAgent {
  private queue: string[] = [];

  enqueue(text: string): void {
    this.queue.push(text);
  }

  async transcribe(_wav: Buffer, _opts: { signal: AbortSignal; language: "vi" }): Promise<string> {
    return this.queue.shift() ?? "";
  }
}

export class FakeTtsAgent implements TtsAgent {
  async synthesize(text: string, _opts: { signal: AbortSignal }): Promise<Buffer> {
    return Buffer.from(`FAKE_AUDIO:${text}`, "utf8");
  }
}

export class FakeModelHealth implements ModelHealth {
  constructor(private ready: { qwen: boolean; stt: boolean; tts: boolean } = { qwen: true, stt: true, tts: true }) {}

  async check(): Promise<{ qwen: boolean; stt: boolean; tts: boolean }> {
    return this.ready;
  }
}

export class FakeCodeExecutor implements CodeExecutor {
  constructor(
    private resultFn: (req: { language: Language; code: string; stdin: string; expectedOutput?: string }) => ExecutionResult,
  ) {}

  async run(req: { language: Language; code: string; stdin: string; expectedOutput?: string; signal: AbortSignal }): Promise<ExecutionResult> {
    return this.resultFn(req);
  }
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npm test -- fakes.test`
Expected: PASS (8 test)

- [ ] **Step 6: Viết test cho `runTestSuite`**

```ts
// src/interview/agents/code-runner.test.ts
import { describe, it, expect } from "vitest";
import { runTestSuite } from "./code-runner";
import { FakeCodeExecutor } from "./fakes";

describe("runTestSuite", () => {
  it("chạy lần lượt từng test case và tổng hợp kết quả pass/fail", async () => {
    const executor = new FakeCodeExecutor((req) => ({
      status: "OK",
      stdout: req.stdin === "1" ? "2" : "wrong",
      stderr: "",
      timeMs: 3,
      passed: req.stdin === "1" ? req.expectedOutput === "2" : false,
    }));
    const results = await runTestSuite(
      executor,
      "python",
      "code",
      [
        { id: 1, input: "1", output: "2" },
        { id: 2, input: "9", output: "10" },
      ],
      new AbortController().signal,
    );
    expect(results).toEqual([
      { id: 1, passed: true, actual: "2", expected: "2", timeMs: 3 },
      { id: 2, passed: false, actual: "wrong", expected: "10", timeMs: 3 },
    ]);
  });

  it("trả mảng rỗng khi không có test case nào", async () => {
    const executor = new FakeCodeExecutor(() => ({ status: "OK", stdout: "", stderr: "", timeMs: 0 }));
    const results = await runTestSuite(executor, "python", "code", [], new AbortController().signal);
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận fail**

Run: `npm test -- code-runner`
Expected: FAIL — module `./code-runner` không tồn tại

- [ ] **Step 8: Viết `src/interview/agents/code-runner.ts`**

```ts
import type { CodeExecutor } from "./types";
import type { Language, TestResultItem } from "../domain/types";

export interface TestSuiteCase {
  id: number;
  input: string;
  output: string;
}

/** Chạy tuần tự từng test case qua executor — giữ tải thấp cho Judge0 local/free tier. */
export async function runTestSuite(
  executor: CodeExecutor,
  language: Language,
  code: string,
  cases: TestSuiteCase[],
  signal: AbortSignal,
): Promise<TestResultItem[]> {
  const results: TestResultItem[] = [];
  for (const c of cases) {
    const res = await executor.run({ language, code, stdin: c.input, expectedOutput: c.output, signal });
    results.push({ id: c.id, passed: res.passed ?? false, actual: res.stdout, expected: c.output, timeMs: res.timeMs });
  }
  return results;
}
```

- [ ] **Step 9: Chạy test, xác nhận pass**

Run: `npm test -- code-runner`
Expected: PASS (2 test)

- [ ] **Step 10: Commit**

```bash
git add src/interview/agents/types.ts src/interview/agents/fakes.ts src/interview/agents/fakes.test.ts src/interview/agents/code-runner.ts src/interview/agents/code-runner.test.ts
git commit -m "feat(interview): add agent interfaces, fake agents, and test-suite runner

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 7: EventRouter (quyết định khi nào gọi AI)

**Files:**
- Create: `src/interview/router/event-router.ts`
- Create: `src/interview/router/event-router.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 3), `CodeRunResult`, `TriggerType` (Task 2).
- Produces: `EventRouter` class, `TriggerPayload` union type — dùng ở Task 16 (WsGateway nối EventRouter với TurnRunner).

Luật cụ thể (spec §5.1, §5.2, đã gộp góp ý "không trigger lại tới khi có hoạt động mới"):
- Bộ đếm im lặng reset khi có hoạt động (`speech.end` có transcript, `editor.update`, `whiteboard.update`, `code.run`, AI nói xong). Hết ngưỡng → phát trigger `silence` **đúng 1 lần**, không lặp lại tới khi có hoạt động mới.
- Mỗi 5 giây kiểm tra `time_warning` (1 lần mỗi chặng, reset khi `onStageEntered()`).
- Khi đang bận (`isBusy() === true`): `speech.start` → gọi `onInterrupt()` và xóa hết trigger đang chờ; các trigger khác được xếp vào hàng đợi, lấy ra bằng `flushPending()`.

- [ ] **Step 1: Viết test**

```ts
// src/interview/router/event-router.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventRouter } from "./event-router";
import { FakeClock } from "../session/clock";

function makeRouter(overrides: Partial<{
  silenceThresholdSec: number; stageElapsedSec: number; stageMaxSec: number; isBusy: boolean;
}> = {}) {
  const clock = new FakeClock();
  const onTrigger = vi.fn();
  const onInterrupt = vi.fn();
  const onStagePrecondition = vi.fn();
  let busy = overrides.isBusy ?? false;
  const router = new EventRouter({
    clock,
    getSilenceThresholdSec: () => overrides.silenceThresholdSec ?? 10,
    getStageElapsedSec: () => overrides.stageElapsedSec ?? 0,
    getStageMaxSec: () => overrides.stageMaxSec ?? 300,
    isBusy: () => busy,
    onTrigger,
    onInterrupt,
    onStagePrecondition,
    canDoneStage: () => ({ ok: true }),
    tickIntervalMs: 5000,
  });
  return { router, clock, onTrigger, onInterrupt, onStagePrecondition, setBusy: (v: boolean) => (busy = v) };
}

describe("EventRouter — silence", () => {
  it("phát trigger silence sau đúng ngưỡng kể từ lúc bắt đầu chặng", () => {
    const { router, clock, onTrigger } = makeRouter({ silenceThresholdSec: 10 });
    router.onStageEntered();
    onTrigger.mockClear();
    clock.advance(9999);
    expect(onTrigger).not.toHaveBeenCalledWith("silence", expect.anything());
    clock.advance(1);
    expect(onTrigger).toHaveBeenCalledWith("silence", { kind: "silence" });
  });

  it("không phát lại silence nếu không có hoạt động mới", () => {
    const { router, clock, onTrigger } = makeRouter({ silenceThresholdSec: 10 });
    router.onStageEntered();
    clock.advance(10_000);
    onTrigger.mockClear();
    clock.advance(20_000);
    expect(onTrigger).not.toHaveBeenCalledWith("silence", expect.anything());
  });

  it("hoạt động (editor.update) reset bộ đếm im lặng", () => {
    const { router, clock, onTrigger } = makeRouter({ silenceThresholdSec: 10 });
    router.onStageEntered();
    clock.advance(9000);
    router.handleEditorUpdate();
    onTrigger.mockClear();
    clock.advance(9000);
    expect(onTrigger).not.toHaveBeenCalledWith("silence", expect.anything());
    clock.advance(1000);
    expect(onTrigger).toHaveBeenCalledWith("silence", { kind: "silence" });
  });
});

describe("EventRouter — time warning", () => {
  it("phát time_warning đúng 1 lần khi qua 80% maxSec", () => {
    const { router, clock, onTrigger } = makeRouter({ stageMaxSec: 100, stageElapsedSec: 0 });
    router.onStageEntered();
    onTrigger.mockClear();
    // giả lập elapsedSec tăng dần qua các lần tick bằng cách advance nhiều lần 5s
    for (let i = 0; i < 20; i++) clock.advance(5000);
    const warningCalls = onTrigger.mock.calls.filter((c) => c[0] === "time_warning");
    expect(warningCalls.length).toBeLessThanOrEqual(1);
  });
});

describe("EventRouter — busy/interrupt", () => {
  it("speech.start khi đang bận thì gọi onInterrupt và xóa trigger đang chờ", () => {
    const { router, onInterrupt, setBusy } = makeRouter();
    setBusy(true);
    router.handleEditorUpdate();
    router.handleWhiteboardDone();
    expect(router.flushPending().length).toBe(1); // whiteboard_done được xếp hàng, editor.update chỉ reset timer không tạo trigger
    router.handleWhiteboardDone();
    router.handleSpeechStart();
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(router.flushPending()).toEqual([]);
  });

  it("trigger không bị mất khi bận, lấy ra được qua flushPending", () => {
    const { router, onTrigger, setBusy } = makeRouter();
    setBusy(true);
    router.handleWhiteboardDone();
    expect(onTrigger).not.toHaveBeenCalled();
    setBusy(false);
    expect(router.flushPending()).toEqual([{ kind: "whiteboard_done" }]);
  });
});

describe("EventRouter — stage.done precondition", () => {
  it("gọi onStagePrecondition khi canDoneStage trả ok:false", () => {
    const clock = new FakeClock();
    const onStagePrecondition = vi.fn();
    const router = new EventRouter({
      clock,
      getSilenceThresholdSec: () => 10,
      getStageElapsedSec: () => 0,
      getStageMaxSec: () => 300,
      isBusy: () => false,
      onTrigger: vi.fn(),
      onInterrupt: vi.fn(),
      onStagePrecondition,
      canDoneStage: () => ({ ok: false, message: "chưa chạy code" }),
    });
    const result = router.handleStageDone();
    expect(result.accepted).toBe(false);
    expect(onStagePrecondition).toHaveBeenCalledWith("chưa chạy code");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- event-router`
Expected: FAIL — module `./event-router` không tồn tại

- [ ] **Step 3: Viết `src/interview/router/event-router.ts`**

```ts
import type { Clock } from "../session/clock";
import type { CodeRunResult, TriggerType } from "../domain/types";

export type TriggerPayload =
  | { kind: "utterance"; transcript: string }
  | { kind: "code_result"; result: CodeRunResult }
  | { kind: "whiteboard_done" }
  | { kind: "stage_enter" }
  | { kind: "silence" }
  | { kind: "time_warning" };

export interface EventRouterOptions {
  clock: Clock;
  getSilenceThresholdSec: () => number;
  getStageElapsedSec: () => number;
  getStageMaxSec: () => number;
  isBusy: () => boolean;
  onTrigger: (trigger: TriggerType, payload: TriggerPayload) => void;
  onInterrupt: () => void;
  onStagePrecondition: (message: string) => void;
  canDoneStage: () => { ok: true } | { ok: false; message: string };
  tickIntervalMs?: number;
}

export class EventRouter {
  private silenceTimer: unknown = null;
  private tickTimer: unknown = null;
  private silenceFiredForCurrentActivity = false;
  private timeWarningFiredForStage = false;
  private pendingTriggers: TriggerPayload[] = [];

  constructor(private opts: EventRouterOptions) {
    this.scheduleTick();
  }

  dispose(): void {
    this.clearSilenceTimer();
    this.clearTick();
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      this.opts.clock.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearTick(): void {
    if (this.tickTimer !== null) {
      this.opts.clock.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private scheduleTick(): void {
    this.clearTick();
    this.tickTimer = this.opts.clock.setTimeout(() => this.onTick(), this.opts.tickIntervalMs ?? 5000);
  }

  private onTick(): void {
    const elapsed = this.opts.getStageElapsedSec();
    const max = this.opts.getStageMaxSec();
    if (!this.timeWarningFiredForStage && elapsed >= max * 0.8) {
      this.timeWarningFiredForStage = true;
      this.emit({ kind: "time_warning" });
    }
    this.scheduleTick();
  }

  onStageEntered(): void {
    this.timeWarningFiredForStage = false;
    this.resetSilenceTimer();
    this.emit({ kind: "stage_enter" });
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceFiredForCurrentActivity = false;
    const ms = this.opts.getSilenceThresholdSec() * 1000;
    this.silenceTimer = this.opts.clock.setTimeout(() => this.onSilenceElapsed(), ms);
  }

  private onSilenceElapsed(): void {
    if (this.silenceFiredForCurrentActivity) return;
    this.silenceFiredForCurrentActivity = true;
    this.emit({ kind: "silence" });
  }

  private recordActivity(): void {
    this.resetSilenceTimer();
  }

  private emit(payload: TriggerPayload): void {
    if (this.opts.isBusy()) {
      this.pendingTriggers.push(payload);
      return;
    }
    this.opts.onTrigger(payload.kind, payload);
  }

  /** Lấy hết trigger đang chờ (gọi sau khi một lượt vừa chạy xong). */
  flushPending(): TriggerPayload[] {
    const pending = this.pendingTriggers;
    this.pendingTriggers = [];
    return pending;
  }

  handleSpeechStart(): void {
    if (this.opts.isBusy()) {
      this.opts.onInterrupt();
      this.pendingTriggers = [];
    }
  }

  handleSpeechEnd(transcript: string): void {
    this.recordActivity();
    if (!transcript) return;
    this.emit({ kind: "utterance", transcript });
  }

  handleEditorUpdate(): void {
    this.recordActivity();
  }

  handleWhiteboardUpdate(): void {
    this.recordActivity();
  }

  handleCodeRunResult(result: CodeRunResult): void {
    this.recordActivity();
    this.emit({ kind: "code_result", result });
  }

  handleWhiteboardDone(): void {
    this.recordActivity();
    this.emit({ kind: "whiteboard_done" });
  }

  handleStageDone(): { accepted: boolean } {
    const check = this.opts.canDoneStage();
    if (!check.ok) {
      this.opts.onStagePrecondition(check.message);
      return { accepted: false };
    }
    return { accepted: true };
  }

  handleAiFinishedSpeaking(): void {
    this.recordActivity();
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- event-router`
Expected: PASS (7 test)

- [ ] **Step 5: Commit**

```bash
git add src/interview/router/event-router.ts src/interview/router/event-router.test.ts
git commit -m "feat(interview): add EventRouter for silence/time/interrupt triggers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 8: PromptBuilder + LlmOutputParser

**Files:**
- Create: `src/interview/turn/prompt-builder.ts`
- Create: `src/interview/turn/prompt-builder.test.ts`
- Create: `src/interview/turn/llm-output-parser.ts`
- Create: `src/interview/turn/llm-output-parser.test.ts`

**Interfaces:**
- Consumes: `SessionSnapshot` (Task 5), `TriggerPayload` (Task 7), `ChatMessage` (Task 6), `LlmTurnOutput`, `TriggerType` (Task 2).
- Produces: `buildPrompt(session, trigger, payload): ChatMessage[]` — dùng ở Task 9. `parseLlmOutput(raw): ParseResult` — dùng ở Task 9, 11.

- [ ] **Step 1: Viết test cho PromptBuilder**

```ts
// src/interview/turn/prompt-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildPrompt } from "./prompt-builder";
import type { SessionSnapshot } from "../session/session";
import { getStageConfig } from "../config/stages";

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    problem: {
      problem_id: "prob_1", title: "Two Sum", description: "desc", difficulty: "EASY", category: "Array",
      starter_code: "", test_cases: [],
      hidden_constraints: ["Mảng có thể có số âm", "Luôn có đúng 1 đáp án"],
      follow_up_topics: ["Nếu mảng đã sắp xếp?"],
    },
    language: "python",
    currentStage: 1,
    stageElapsedSec: 30,
    stageConfig: getStageConfig(1),
    recentTurns: [],
    latestCode: "",
    latestBoard: null,
    revealedConstraints: [],
    coveredTopics: [],
    lastCodeRun: null,
    hiddenTestsPassed: 0,
    hiddenTestsTotal: 0,
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("trả về [system, user], system chứa tên chặng và toàn bộ hidden_constraints", () => {
    const messages = buildPrompt(snapshot(), "utterance", { kind: "utterance", transcript: "mảng có số âm không?" });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Làm rõ yêu cầu");
    expect(messages[0].content).toContain("Mảng có thể có số âm");
    expect(messages[0].content).toContain("Luôn có đúng 1 đáp án");
  });

  it("system đánh dấu ràng buộc đã tiết lộ khác với chưa tiết lộ", () => {
    const messages = buildPrompt(snapshot({ revealedConstraints: [0] }), "utterance", {
      kind: "utterance", transcript: "còn gì nữa không?",
    });
    expect(messages[0].content).toMatch(/\[đã tiết lộ\].*Mảng có thể có số âm/s);
  });

  it("user message chứa transcript khi trigger là utterance", () => {
    const messages = buildPrompt(snapshot(), "utterance", { kind: "utterance", transcript: "em dùng hash map" });
    expect(messages[1].content).toContain("em dùng hash map");
  });

  it("user message mô tả kết quả code khi trigger là code_result", () => {
    const messages = buildPrompt(snapshot(), "code_result", {
      kind: "code_result",
      result: { runId: "r1", mode: "sample", status: "OK", tests: [{ id: 1, passed: true, actual: "1", expected: "1", timeMs: 5 }] },
    });
    expect(messages[1].content).toContain("code_result");
  });

  it("chặng 3 (viết mã) có hướng dẫn mặc định im lặng quan sát trong system message", () => {
    const messages = buildPrompt(snapshot({ currentStage: 3, stageConfig: getStageConfig(3) }), "silence", { kind: "silence" });
    expect(messages[0].content).toMatch(/mặc định.*im lặng|listen/i);
  });

  it("chặng 4 kèm số liệu test ẩn vào system message", () => {
    const messages = buildPrompt(
      snapshot({ currentStage: 4, stageConfig: getStageConfig(4), hiddenTestsPassed: 3, hiddenTestsTotal: 5 }),
      "code_result",
      { kind: "code_result", result: { runId: "r1", mode: "custom", status: "OK" } },
    );
    expect(messages[0].content).toContain("3/5");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- prompt-builder`
Expected: FAIL — module `./prompt-builder` không tồn tại

- [ ] **Step 3: Viết `src/interview/turn/prompt-builder.ts`**

```ts
import type { ChatMessage } from "../agents/types";
import type { TriggerType } from "../domain/types";
import type { SessionSnapshot } from "../session/session";
import type { TriggerPayload } from "../router/event-router";

const STAGE_GUIDE: Record<number, string> = {
  1: "Chặng này bạn cố tình trình bày đề THIẾU ràng buộc. Chỉ tiết lộ đúng 1 mục hidden_constraints khi ứng viên hỏi trúng ý đó, hoặc khi họ tự đặt giả định cần bạn xác nhận. Đừng tự ý tiết lộ hết.",
  2: "Đồng thuận nếu giải thuật hợp lý; phản biện nếu giải thuật chậm hoặc Big-O sai.",
  3: "Mặc định trả action=listen, chỉ quan sát. Chỉ action=speak để gợi mở khi trigger là silence hoặc time_warning.",
  4: "Yêu cầu ứng viên tự nghĩ test case. Nếu họ nói đã ổn nhưng test ẩn vẫn còn fail, đưa ra ĐÚNG một test case đang fail làm phản chứng — không tự bịa test khác.",
  5: "Hỏi theo follow_up_topics; hết chủ đề thì tự đặt câu hỏi sâu hơn về mở rộng hệ thống. Đọc sơ đồ whiteboard nếu có.",
  6: "Trả lời câu hỏi ngược của ứng viên. Khi họ bấm kết thúc, action=end.",
};

function formatList(items: string[] | undefined, revealedOrCovered: number[]): string {
  if (!items || items.length === 0) return "(không có, tự suy ra từ mô tả đề nếu cần)";
  return items
    .map((text, i) => `${i}. ${revealedOrCovered.includes(i) ? "[đã tiết lộ] " : ""}${text}`)
    .join("\n");
}

function buildSystemMessage(session: SessionSnapshot): string {
  const { problem, stageConfig, currentStage, stageElapsedSec } = session;
  const parts = [
    "Bạn là một Tech Lead đang phỏng vấn thử một ứng viên, nói tiếng Việt, ngắn gọn, không đưa lời giải trực tiếp.",
    `Đề bài: ${problem.title}\n${problem.description}`,
    `Ràng buộc ẩn (chỉ bạn biết):\n${formatList(problem.hidden_constraints, session.revealedConstraints)}`,
    `Chủ đề mở rộng (chỉ bạn biết):\n${formatList(problem.follow_up_topics, session.coveredTopics)}`,
    `Chặng hiện tại: ${currentStage}. ${stageConfig.name} (đã dùng ${stageElapsedSec}s / tối thiểu ${stageConfig.minSec}s / tối đa ${stageConfig.maxSec}s).`,
    STAGE_GUIDE[currentStage] ?? "",
    `Code hiện tại:\n${session.latestCode || "(chưa có)"}`,
  ];
  if (currentStage === 4) {
    parts.push(`Test ẩn: pass ${session.hiddenTestsPassed}/${session.hiddenTestsTotal}.`);
  }
  if (session.latestBoard) {
    parts.push(`Sơ đồ whiteboard: ${JSON.stringify(session.latestBoard)}`);
  }
  parts.push(
    'Luôn trả lời bằng đúng một JSON: {"action":"speak|listen|next_stage|end","reply":"...","note":"..."|null,"revealed_constraints":[chỉ số],"covered_topics":[chỉ số]}. Không thêm chữ nào ngoài JSON.',
  );
  return parts.join("\n\n");
}

function buildUserMessage(trigger: TriggerType, payload: TriggerPayload): string {
  switch (payload.kind) {
    case "utterance":
      return `[utterance] Ứng viên nói: "${payload.transcript}"`;
    case "code_result":
      return `[code_result] Kết quả chạy code: ${JSON.stringify(payload.result)}`;
    case "whiteboard_done":
      return "[whiteboard_done] Ứng viên vừa báo xong sơ đồ.";
    case "stage_enter":
      return "[stage_enter] Vừa chuyển sang chặng mới, hãy mở đầu chặng.";
    case "silence":
      return "[silence] Ứng viên im lặng quá lâu, không nói cũng không thao tác.";
    case "time_warning":
      return "[time_warning] Sắp hết thời gian tối đa của chặng này.";
    default:
      return `[${trigger}]`;
  }
}

export function buildPrompt(session: SessionSnapshot, trigger: TriggerType, payload: TriggerPayload): ChatMessage[] {
  return [
    { role: "system", content: buildSystemMessage(session) },
    { role: "user", content: buildUserMessage(trigger, payload) },
  ];
}
```

- [ ] **Step 4: Chạy test PromptBuilder, xác nhận pass**

Run: `npm test -- prompt-builder`
Expected: PASS (6 test)

- [ ] **Step 5: Viết test cho LlmOutputParser**

```ts
// src/interview/turn/llm-output-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseLlmOutput } from "./llm-output-parser";

describe("parseLlmOutput", () => {
  it("parse đúng JSON hợp lệ", () => {
    const raw = '{"action":"speak","reply":"chào bạn","note":null,"revealed_constraints":[0],"covered_topics":[]}';
    const result = parseLlmOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("speak");
      expect(result.value.reply).toBe("chào bạn");
    }
  });

  it("bóc tách được JSON dù model bọc thêm markdown fence", () => {
    const raw = '```json\n{"action":"listen","reply":"","note":null,"revealed_constraints":[],"covered_topics":[]}\n```';
    const result = parseLlmOutput(raw);
    expect(result.ok).toBe(true);
  });

  it("báo lỗi khi không tìm thấy khối JSON nào", () => {
    const result = parseLlmOutput("mình không chắc nữa");
    expect(result).toEqual({ ok: false, error: "NO_JSON_FOUND" });
  });

  it("báo lỗi khi JSON.parse thất bại", () => {
    const result = parseLlmOutput("{action: speak}"); // thiếu dấu ngoặc kép
    expect(result.ok).toBe(false);
  });

  it("báo lỗi khi thiếu field bắt buộc action", () => {
    const result = parseLlmOutput('{"reply":"hi","note":null,"revealed_constraints":[],"covered_topics":[]}');
    expect(result).toEqual({ ok: false, error: "SCHEMA_MISMATCH" });
  });

  it("báo lỗi khi action không thuộc enum hợp lệ", () => {
    const result = parseLlmOutput('{"action":"shout","reply":"","note":null,"revealed_constraints":[],"covered_topics":[]}');
    expect(result.ok).toBe(false);
  });

  it("mặc định revealed_constraints/covered_topics thành mảng rỗng nếu thiếu", () => {
    const result = parseLlmOutput('{"action":"listen","reply":"","note":null}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revealed_constraints).toEqual([]);
      expect(result.value.covered_topics).toEqual([]);
    }
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận fail**

Run: `npm test -- llm-output-parser`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 7: Viết `src/interview/turn/llm-output-parser.ts`**

```ts
import { z } from "zod";
import type { LlmTurnOutput } from "../domain/types";

const LlmTurnOutputSchema = z.object({
  action: z.enum(["speak", "listen", "next_stage", "end"]),
  reply: z.string(),
  note: z.string().nullable(),
  revealed_constraints: z.array(z.number().int()).default([]),
  covered_topics: z.array(z.number().int()).default([]),
});

export type ParseResult = { ok: true; value: LlmTurnOutput } | { ok: false; error: string };

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export function parseLlmOutput(raw: string): ParseResult {
  const jsonText = extractJson(raw);
  if (jsonText === null) return { ok: false, error: "NO_JSON_FOUND" };
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  const result = LlmTurnOutputSchema.safeParse(data);
  if (!result.success) return { ok: false, error: "SCHEMA_MISMATCH" };
  return { ok: true, value: result.data };
}
```

- [ ] **Step 8: Chạy test, xác nhận pass**

Run: `npm test -- llm-output-parser`
Expected: PASS (7 test)

- [ ] **Step 9: Commit**

```bash
git add src/interview/turn/prompt-builder.ts src/interview/turn/prompt-builder.test.ts src/interview/turn/llm-output-parser.ts src/interview/turn/llm-output-parser.test.ts
git commit -m "feat(interview): add prompt builder and LLM JSON output parser

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 9: SpeechBuffer + TurnRunner

**Files:**
- Create: `src/interview/turn/speech-buffer.ts`
- Create: `src/interview/turn/speech-buffer.test.ts`
- Create: `src/interview/turn/turn-runner.ts`
- Create: `src/interview/turn/turn-runner.test.ts`

**Interfaces:**
- Consumes: `SttAgent`, `LlmAgent`, `TtsAgent` (Task 6), `buildPrompt` (Task 8), `parseLlmOutput` (Task 8), `SessionSnapshot` (Task 5), `TriggerPayload` (Task 7), `Turn`, `LlmAction`, `TriggerType`, `LlmTurnOutput` (Task 2).
- Produces: `pcm16ToWav(pcm, sampleRate): Buffer`, `SpeechBuffer` class (`addChunk`, `pause(signal)`, `end(signal)`, `reset()`) — dùng ở Task 16. `TurnRunner` class (`run(ctx): Promise<TurnRunResult>` với `TurnRunResult = { turn, stageAction, revealedConstraints: number[], coveredTopics: number[] }`), `TurnOutputSink` interface, `TurnContext` type — dùng ở Task 16.

- [ ] **Step 1: Viết test cho `pcm16ToWav` + `SpeechBuffer`**

```ts
// src/interview/turn/speech-buffer.test.ts
import { describe, it, expect } from "vitest";
import { pcm16ToWav, SpeechBuffer } from "./speech-buffer";
import type { SttAgent } from "../agents/types";

function countingStt(transcript: string) {
  let calls = 0;
  const stt: SttAgent = {
    async transcribe() {
      calls += 1;
      return transcript;
    },
  };
  return { stt, getCalls: () => calls };
}

describe("pcm16ToWav", () => {
  it("tạo header RIFF/WAVE đúng chuẩn và giữ nguyên dữ liệu PCM", () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const wav = pcm16ToWav(pcm, 16000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.subarray(44)).toEqual(pcm);
  });
});

describe("SpeechBuffer", () => {
  it("end() không pause trước đó thì transcribe toàn bộ chunk đã gom", async () => {
    const { stt, getCalls } = countingStt("xin chào");
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1, 2]));
    buf.addChunk(Buffer.from([3, 4]));
    const { transcript } = await buf.end(new AbortController().signal);
    expect(transcript).toBe("xin chào");
    expect(getCalls()).toBe(1);
  });

  it("pause() rồi end() không có chunk mới thì dùng lại kết quả cache, không gọi STT lần 2", async () => {
    const { stt, getCalls } = countingStt("em dùng hash map");
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1]));
    await buf.pause(new AbortController().signal);
    const { transcript } = await buf.end(new AbortController().signal);
    expect(transcript).toBe("em dùng hash map");
    expect(getCalls()).toBe(1);
  });

  it("có chunk mới sau pause() thì end() transcribe lại toàn bộ", async () => {
    let call = 0;
    const stt: SttAgent = {
      async transcribe() {
        call += 1;
        return call === 1 ? "phần 1" : "phần 1 phần 2";
      },
    };
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1]));
    await buf.pause(new AbortController().signal);
    buf.addChunk(Buffer.from([2]));
    const { transcript } = await buf.end(new AbortController().signal);
    expect(transcript).toBe("phần 1 phần 2");
    expect(call).toBe(2);
  });

  it("end() reset state, nên lượt nói kế tiếp transcribe lại từ đầu", async () => {
    const { stt, getCalls } = countingStt("a");
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1]));
    await buf.end(new AbortController().signal);
    expect(getCalls()).toBe(1);
    buf.addChunk(Buffer.from([2]));
    await buf.end(new AbortController().signal);
    expect(getCalls()).toBe(2);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- speech-buffer`
Expected: FAIL — module `./speech-buffer` không tồn tại

- [ ] **Step 3: Viết `src/interview/turn/speech-buffer.ts`**

```ts
import type { SttAgent } from "../agents/types";

export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class SpeechBuffer {
  private chunks: Buffer[] = [];
  private lastTranscribedAtChunkCount = 0;
  private cachedTranscript = "";

  constructor(private stt: SttAgent, private sampleRate = 16000) {}

  addChunk(chunk: Buffer): void {
    this.chunks.push(chunk);
  }

  /** Chạy Whisper trước khi ứng viên còn im lặng 0.8s, để bù thời gian chờ khi speech.end tới. */
  async pause(signal: AbortSignal): Promise<void> {
    if (this.chunks.length === this.lastTranscribedAtChunkCount) return;
    this.cachedTranscript = await this.transcribeAll(signal);
    this.lastTranscribedAtChunkCount = this.chunks.length;
  }

  async end(signal: AbortSignal): Promise<{ transcript: string; sttMs: number }> {
    const startedAt = Date.now();
    const transcript =
      this.chunks.length === this.lastTranscribedAtChunkCount && this.cachedTranscript
        ? this.cachedTranscript
        : await this.transcribeAll(signal);
    const sttMs = Date.now() - startedAt;
    this.reset();
    return { transcript, sttMs };
  }

  reset(): void {
    this.chunks = [];
    this.lastTranscribedAtChunkCount = 0;
    this.cachedTranscript = "";
  }

  private async transcribeAll(signal: AbortSignal): Promise<string> {
    const wav = pcm16ToWav(Buffer.concat(this.chunks), this.sampleRate);
    return this.stt.transcribe(wav, { signal, language: "vi" });
  }
}
```

- [ ] **Step 4: Chạy test SpeechBuffer, xác nhận pass**

Run: `npm test -- speech-buffer`
Expected: PASS (5 test)

- [ ] **Step 5: Viết test cho TurnRunner**

```ts
// src/interview/turn/turn-runner.test.ts
import { describe, it, expect } from "vitest";
import { TurnRunner, type TurnOutputSink } from "./turn-runner";
import { FakeLlmAgent, FakeTtsAgent } from "../agents/fakes";
import { getStageConfig } from "../config/stages";
import type { SessionSnapshot } from "../session/session";

function snapshot(): SessionSnapshot {
  return {
    problem: { problem_id: "p1", title: "t", description: "d", difficulty: "EASY", category: "Array", starter_code: "", test_cases: [] },
    language: "python",
    currentStage: 1,
    stageElapsedSec: 10,
    stageConfig: getStageConfig(1),
    recentTurns: [],
    latestCode: "",
    latestBoard: null,
    revealedConstraints: [],
    coveredTopics: [],
    lastCodeRun: null,
    hiddenTestsPassed: 0,
    hiddenTestsTotal: 0,
  };
}

function makeSink() {
  const calls: string[] = [];
  const chunks: Buffer[] = [];
  const sink: TurnOutputSink = {
    onAiReply: (_id, text) => calls.push(`reply:${text}`),
    onAiSpeechStart: () => calls.push("start"),
    onAiSpeechChunk: (_id, chunk) => { calls.push("chunk"); chunks.push(chunk); },
    onAiSpeechEnd: () => calls.push("end"),
  };
  return { sink, calls, chunks };
}

function ctxWith(overrides: Partial<{ signal: AbortSignal }> = {}) {
  return {
    session: snapshot(),
    trigger: "utterance" as const,
    payload: { kind: "utterance" as const, transcript: "em dùng hash map" },
    signal: overrides.signal ?? new AbortController().signal,
  };
}

describe("TurnRunner", () => {
  it("action=speak: gửi reply, phát TTS theo từng câu, ghi latency", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Câu một. Câu hai.", note: null, revealed_constraints: [], covered_topics: [] }));
    const { sink, calls, chunks } = makeSink();
    const runner = new TurnRunner({ llm, tts: new FakeTtsAgent(), sink });
    const { turn, stageAction } = await runner.run(ctxWith());
    expect(stageAction).toBe("speak");
    expect(turn.text).toBe("Câu một. Câu hai.");
    expect(chunks.length).toBe(2);
    expect(calls[0]).toBe("start");
    expect(calls.at(-1)).toBe("end");
    expect(turn.latencyMs?.llm).toBeGreaterThanOrEqual(0);
    expect(turn.latencyMs?.ttsFirstAudio).toBeGreaterThanOrEqual(0);
  });

  it("action=listen với reply rỗng: không gọi TTS/sink lần nào", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue(JSON.stringify({ action: "listen", reply: "", note: "đang quan sát", revealed_constraints: [], covered_topics: [] }));
    const { sink, calls } = makeSink();
    const runner = new TurnRunner({ llm, tts: new FakeTtsAgent(), sink });
    const { turn, stageAction } = await runner.run(ctxWith());
    expect(stageAction).toBe("listen");
    expect(turn.note).toBe("đang quan sát");
    expect(calls).toEqual([]);
  });

  it("LLM ném lỗi: trả turn dự phòng, action=listen, error=LLM_UNAVAILABLE", async () => {
    const llm = { chat: async () => { throw new Error("timeout"); } };
    const { sink, calls } = makeSink();
    const runner = new TurnRunner({ llm, tts: new FakeTtsAgent(), sink });
    const { turn, stageAction } = await runner.run(ctxWith());
    expect(stageAction).toBe("listen");
    expect(turn.error).toBe("LLM_UNAVAILABLE");
    expect(turn.text).toBe("Bạn cho mình vài giây nhé.");
    expect(calls[0]).toBe("start"); // vẫn nói câu dự phòng
  });

  it("JSON sai lần đầu, đúng ở lần retry: dùng kết quả retry, gọi LLM đúng 2 lần", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue("không phải JSON");
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Đã hiểu.", note: null, revealed_constraints: [], covered_topics: [] }));
    const { sink } = makeSink();
    const runner = new TurnRunner({ llm, tts: new FakeTtsAgent(), sink });
    const { turn } = await runner.run(ctxWith());
    expect(turn.text).toBe("Đã hiểu.");
    expect(llm.callCount).toBe(2);
  });

  it("JSON sai cả 2 lần: fallback dùng nguyên văn bản thô làm reply, action=speak", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue("sai 1");
    llm.enqueue("sai 2");
    const { sink } = makeSink();
    const runner = new TurnRunner({ llm, tts: new FakeTtsAgent(), sink });
    const { turn, stageAction } = await runner.run(ctxWith());
    expect(stageAction).toBe("speak");
    expect(turn.text).toBe("sai 2");
  });

  it("dừng phát audio ngay khi signal bị abort giữa chừng (ngắt lời)", async () => {
    const controller = new AbortController();
    const llm = new FakeLlmAgent();
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Câu một. Câu hai.", note: null, revealed_constraints: [], covered_topics: [] }));
    const tts = new FakeTtsAgent();
    let ttsCallCount = 0;
    tts.synthesize = async (text, opts) => {
      ttsCallCount += 1;
      if (ttsCallCount === 1) controller.abort();
      return Buffer.from(text);
    };
    const { sink, chunks, calls } = makeSink();
    const runner = new TurnRunner({ llm, tts, sink });
    await runner.run(ctxWith({ signal: controller.signal }));
    expect(chunks.length).toBe(1);
    expect(calls).not.toContain("end");
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận fail**

Run: `npm test -- turn-runner`
Expected: FAIL — module `./turn-runner` không tồn tại

- [ ] **Step 7: Viết `src/interview/turn/turn-runner.ts`**

```ts
import { randomUUID } from "node:crypto";
import type { LlmAgent, TtsAgent } from "../agents/types";
import type { LlmAction, LlmTurnOutput, Turn, TriggerType } from "../domain/types";
import type { SessionSnapshot } from "../session/session";
import type { TriggerPayload } from "../router/event-router";
import { buildPrompt } from "./prompt-builder";
import { parseLlmOutput } from "./llm-output-parser";

export interface TurnOutputSink {
  onAiReply(utteranceId: string, text: string): void;
  onAiSpeechStart(utteranceId: string): void;
  onAiSpeechChunk(utteranceId: string, chunk: Buffer): void;
  onAiSpeechEnd(utteranceId: string): void;
}

export interface TurnContext {
  session: SessionSnapshot;
  trigger: TriggerType;
  payload: TriggerPayload;
  signal: AbortSignal;
}

export interface TurnRunnerDeps {
  llm: LlmAgent;
  tts: TtsAgent;
  sink: TurnOutputSink;
}

export interface TurnRunResult {
  turn: Turn;
  stageAction: LlmAction;
  revealedConstraints: number[];
  coveredTopics: number[];
}

const RETRY_INSTRUCTION =
  "Định dạng JSON của bạn không hợp lệ. Hãy trả lời lại đúng định dạng JSON đã yêu cầu, không thêm chữ nào khác.";
const FALLBACK_TEXT = "Bạn cho mình vài giây nhé.";

export class TurnRunner {
  constructor(private deps: TurnRunnerDeps) {}

  async run(ctx: TurnContext): Promise<TurnRunResult> {
    const startedAt = Date.now();
    const messages = buildPrompt(ctx.session, ctx.trigger, ctx.payload);

    let raw = "";
    let llmFailed = false;
    try {
      raw = await this.deps.llm.chat(messages, { signal: ctx.signal, maxTokens: 400, json: true });
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      llmFailed = true;
    }

    let output: LlmTurnOutput;
    if (llmFailed) {
      output = { action: "listen", reply: FALLBACK_TEXT, note: null, revealed_constraints: [], covered_topics: [] };
    } else {
      let parsed = parseLlmOutput(raw);
      if (!parsed.ok) {
        try {
          raw = await this.deps.llm.chat([...messages, { role: "user", content: RETRY_INSTRUCTION }], {
            signal: ctx.signal,
            maxTokens: 400,
            json: true,
          });
          parsed = parseLlmOutput(raw);
        } catch {
          // giữ nguyên parsed lỗi, rơi xuống nhánh fallback bên dưới
        }
      }
      output = parsed.ok
        ? parsed.value
        : { action: "speak", reply: raw, note: null, revealed_constraints: [], covered_topics: [] };
    }

    const llmMs = Date.now() - startedAt;
    const turn: Turn = {
      turnId: randomUUID(),
      role: "ai",
      stage: ctx.session.currentStage,
      trigger: ctx.trigger,
      text: output.reply,
      action: output.action,
      note: output.note ?? undefined,
      interrupted: false,
      createdAt: new Date().toISOString(),
      latencyMs: { llm: llmMs },
      ...(llmFailed ? { error: "LLM_UNAVAILABLE" } : {}),
    };

    if (output.reply) {
      await this.speak(turn, ctx.signal);
    }

    return {
      turn,
      stageAction: output.action,
      revealedConstraints: output.revealed_constraints,
      coveredTopics: output.covered_topics,
    };
  }

  private async speak(turn: Turn, signal: AbortSignal): Promise<void> {
    this.deps.sink.onAiSpeechStart(turn.turnId);
    this.deps.sink.onAiReply(turn.turnId, turn.text);
    const sentences = turn.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const ttsStart = Date.now();
    let first = true;
    for (const sentence of sentences) {
      if (signal.aborted) return;
      const audio = await this.deps.tts.synthesize(sentence, { signal });
      if (first) {
        turn.latencyMs = { ...turn.latencyMs, ttsFirstAudio: Date.now() - ttsStart };
        first = false;
      }
      this.deps.sink.onAiSpeechChunk(turn.turnId, audio);
    }
    turn.latencyMs = { ...turn.latencyMs, ttsTotal: Date.now() - ttsStart };
    this.deps.sink.onAiSpeechEnd(turn.turnId);
  }
}
```

- [ ] **Step 8: Chạy test, xác nhận pass**

Run: `npm test -- turn-runner`
Expected: PASS (6 test)

- [ ] **Step 9: Commit**

```bash
git add src/interview/turn/speech-buffer.ts src/interview/turn/speech-buffer.test.ts src/interview/turn/turn-runner.ts src/interview/turn/turn-runner.test.ts
git commit -m "feat(interview): add SpeechBuffer and TurnRunner orchestration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 10: Metrics collector

**Files:**
- Create: `src/interview/metrics/metrics.ts`
- Create: `src/interview/metrics/metrics.test.ts`

**Interfaces:**
- Consumes: không có (module độc lập).
- Produces: `MetricsCollector` (`recordTurnLatency`, `recordError`, `recordJsonOutcome`, `summary()`), `LatencySample`, `MetricsSummary` — dùng ở Task 16 (WsGateway ghi lại mỗi lượt), Task 17 (REST trả `metrics` trong report).

- [ ] **Step 1: Viết test**

```ts
// src/interview/metrics/metrics.test.ts
import { describe, it, expect } from "vitest";
import { MetricsCollector } from "./metrics";

describe("MetricsCollector", () => {
  it("summary() trả null cho mọi chỉ số khi chưa có sample nào", () => {
    const m = new MetricsCollector();
    const s = m.summary();
    expect(s.llm).toBeNull();
    expect(s.jsonValidRate).toBeNull();
  });

  it("tính median và p95 đúng từ các sample llmMs", () => {
    const m = new MetricsCollector();
    for (const ms of [100, 200, 300, 400, 500]) m.recordTurnLatency({ llmMs: ms });
    const s = m.summary();
    expect(s.llm).toEqual({ median: 300, p95: 500 });
  });

  it("bỏ qua field không có mặt trong sample khi tính riêng từng chỉ số", () => {
    const m = new MetricsCollector();
    m.recordTurnLatency({ llmMs: 100 });
    m.recordTurnLatency({ sttMs: 50 });
    const s = m.summary();
    expect(s.llm).toEqual({ median: 100, p95: 100 });
    expect(s.stt).toEqual({ median: 50, p95: 50 });
  });

  it("đếm lỗi theo từng agent", () => {
    const m = new MetricsCollector();
    m.recordError("llm");
    m.recordError("llm");
    m.recordError("tts");
    expect(m.summary().errorCounts).toEqual({ llm: 2, tts: 1 });
  });

  it("tính tỷ lệ JSON hợp lệ", () => {
    const m = new MetricsCollector();
    m.recordJsonOutcome(true);
    m.recordJsonOutcome(true);
    m.recordJsonOutcome(false);
    expect(m.summary().jsonValidRate).toBeCloseTo(2 / 3);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- metrics`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 3: Viết `src/interview/metrics/metrics.ts`**

```ts
export interface LatencySample {
  sttMs?: number;
  llmMs?: number;
  ttsFirstAudioMs?: number;
  ttsTotalMs?: number;
  totalMs?: number;
}

export interface PercentileStats { median: number; p95: number; }

export interface MetricsSummary {
  stt: PercentileStats | null;
  llm: PercentileStats | null;
  ttsFirstAudio: PercentileStats | null;
  total: PercentileStats | null;
  errorCounts: Record<string, number>;
  jsonValidRate: number | null;
}

function isNumber(x: number | undefined): x is number {
  return typeof x === "number";
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function percentileStats(values: number[]): PercentileStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

export class MetricsCollector {
  private samples: LatencySample[] = [];
  private errorCounts: Record<string, number> = {};
  private jsonValidCount = 0;
  private jsonInvalidCount = 0;

  recordTurnLatency(sample: LatencySample): void {
    this.samples.push(sample);
  }

  recordError(agent: string): void {
    this.errorCounts[agent] = (this.errorCounts[agent] ?? 0) + 1;
  }

  recordJsonOutcome(valid: boolean): void {
    if (valid) this.jsonValidCount += 1;
    else this.jsonInvalidCount += 1;
  }

  summary(): MetricsSummary {
    const total = this.jsonValidCount + this.jsonInvalidCount;
    return {
      stt: percentileStats(this.samples.map((s) => s.sttMs).filter(isNumber)),
      llm: percentileStats(this.samples.map((s) => s.llmMs).filter(isNumber)),
      ttsFirstAudio: percentileStats(this.samples.map((s) => s.ttsFirstAudioMs).filter(isNumber)),
      total: percentileStats(this.samples.map((s) => s.totalMs).filter(isNumber)),
      errorCounts: { ...this.errorCounts },
      jsonValidRate: total === 0 ? null : this.jsonValidCount / total,
    };
  }
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- metrics`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add src/interview/metrics/metrics.ts src/interview/metrics/metrics.test.ts
git commit -m "feat(interview): add metrics collector for latency and error rates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 11: Evaluation (bản nhận xét cuối buổi)

**Files:**
- Create: `src/interview/evaluation/evaluation.ts`
- Create: `src/interview/evaluation/evaluation.test.ts`

**Interfaces:**
- Consumes: `LlmAgent` (Task 6), `EvaluationResult`, `Problem`, `Stage`, `Turn` (Task 2).
- Produces: `EvaluationInput` type, `computeObjectiveMetrics(input): EvaluationResult["objective"]`, `buildEvaluation(llm, input): Promise<EvaluationResult>` — dùng ở Task 16.

- [ ] **Step 1: Viết test**

```ts
// src/interview/evaluation/evaluation.test.ts
import { describe, it, expect } from "vitest";
import { buildEvaluation, computeObjectiveMetrics, type EvaluationInput } from "./evaluation";
import { FakeLlmAgent } from "../agents/fakes";
import type { Problem } from "../domain/types";

const PROBLEM: Problem = {
  problem_id: "p1", title: "Two Sum", description: "d", difficulty: "EASY", category: "Array",
  starter_code: "", test_cases: [], hidden_constraints: ["c1", "c2", "c3", "c4"],
};

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    problem: PROBLEM,
    revealedConstraints: [0, 1],
    coveredTopics: [],
    hintsGiven: 2,
    codeRunsCount: 5,
    interruptions: 1,
    stageDurationsSec: { "1": 70, "2": 410 },
    forcedTransitions: [3],
    hiddenTestsPassed: 7,
    hiddenTestsTotal: 10,
    recentTurns: [],
    allNotes: ["tự tối ưu từ O(n^2) xuống O(n)"],
    latestCode: "def two_sum(): pass",
    ...overrides,
  };
}

describe("computeObjectiveMetrics", () => {
  it("tính đúng constraints_clarified/total và các số liệu khách quan khác", () => {
    const objective = computeObjectiveMetrics(input());
    expect(objective).toEqual({
      hidden_tests_passed: 7,
      hidden_tests_total: 10,
      constraints_clarified: 2,
      constraints_total: 4,
      hints_given: 2,
      code_runs: 5,
      interruptions: 1,
      stage_durations_sec: { "1": 70, "2": 410 },
      forced_transitions: [3],
    });
  });
});

describe("buildEvaluation", () => {
  it("dùng pillars từ LLM khi JSON hợp lệ", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue(
      JSON.stringify({
        pillars: {
          problem_solving: { strengths: ["tự tối ưu"], improvements: [] },
          code_quality: { strengths: [], improvements: [] },
          testing_debugging: { strengths: [], improvements: ["chưa test case số âm"] },
          communication: { strengths: [], improvements: [] },
        },
        summary: "Làm tốt.",
      }),
    );
    const result = await buildEvaluation(llm, input());
    expect(result.pillars?.problem_solving.strengths).toEqual(["tự tối ưu"]);
    expect(result.summary).toBe("Làm tốt.");
    expect(result.objective.hidden_tests_passed).toBe(7);
  });

  it("pillars=null và summary mặc định khi LLM trả JSON sai định dạng", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue("không phải JSON hợp lệ");
    const result = await buildEvaluation(llm, input());
    expect(result.pillars).toBeNull();
    expect(result.summary).toBe("Không tạo được nhận xét tự động.");
    expect(result.objective.constraints_clarified).toBe(2);
  });

  it("pillars=null khi LLM ném lỗi, objective vẫn đầy đủ", async () => {
    const llm = { chat: async () => { throw new Error("timeout"); } };
    const result = await buildEvaluation(llm, input());
    expect(result.pillars).toBeNull();
    expect(result.objective.code_runs).toBe(5);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- evaluation`
Expected: FAIL — module chưa tồn tại

- [ ] **Step 3: Viết `src/interview/evaluation/evaluation.ts`**

```ts
import { z } from "zod";
import type { LlmAgent } from "../agents/types";
import type { EvaluationResult, Problem, Stage, Turn } from "../domain/types";

export interface EvaluationInput {
  problem: Problem;
  revealedConstraints: number[];
  coveredTopics: number[];
  hintsGiven: number;
  codeRunsCount: number;
  interruptions: number;
  stageDurationsSec: Record<string, number>;
  forcedTransitions: Stage[];
  hiddenTestsPassed: number;
  hiddenTestsTotal: number;
  recentTurns: Turn[];
  allNotes: string[];
  latestCode: string;
}

export function computeObjectiveMetrics(input: EvaluationInput): EvaluationResult["objective"] {
  return {
    hidden_tests_passed: input.hiddenTestsPassed,
    hidden_tests_total: input.hiddenTestsTotal,
    constraints_clarified: input.revealedConstraints.length,
    constraints_total: input.problem.hidden_constraints?.length ?? 0,
    hints_given: input.hintsGiven,
    code_runs: input.codeRunsCount,
    interruptions: input.interruptions,
    stage_durations_sec: input.stageDurationsSec,
    forced_transitions: input.forcedTransitions,
  };
}

const PillarSchema = z.object({ strengths: z.array(z.string()), improvements: z.array(z.string()) });
const EvaluationOutputSchema = z.object({
  pillars: z.object({
    problem_solving: PillarSchema,
    code_quality: PillarSchema,
    testing_debugging: PillarSchema,
    communication: PillarSchema,
  }),
  summary: z.string(),
});

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseEvaluationOutput(raw: string): { ok: true; value: z.infer<typeof EvaluationOutputSchema> } | { ok: false } {
  const jsonText = extractJson(raw);
  if (!jsonText) return { ok: false };
  try {
    const data = JSON.parse(jsonText);
    const result = EvaluationOutputSchema.safeParse(data);
    return result.success ? { ok: true, value: result.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function buildEvaluationPrompt(input: EvaluationInput): { role: "system" | "user"; content: string }[] {
  const transcript = input.recentTurns.map((t) => `[${t.role}] ${t.text}`).join("\n");
  return [
    {
      role: "system",
      content:
        'Bạn viết nhận xét cuối buổi phỏng vấn thử theo 4 trụ cột: problem_solving, code_quality, testing_debugging, communication. ' +
        'KHÔNG chấm điểm số, chỉ nhận xét định tính. Trả về đúng JSON: ' +
        '{"pillars":{"problem_solving":{"strengths":[],"improvements":[]},"code_quality":{"strengths":[],"improvements":[]},"testing_debugging":{"strengths":[],"improvements":[]},"communication":{"strengths":[],"improvements":[]}},"summary":"..."}',
    },
    {
      role: "user",
      content: [
        `Đề bài: ${input.problem.title}`,
        `Ghi chú tích lũy trong buổi: ${input.allNotes.join(" | ") || "(không có)"}`,
        `Code cuối cùng:\n${input.latestCode}`,
        `Transcript gần đây:\n${transcript}`,
      ].join("\n\n"),
    },
  ];
}

export async function buildEvaluation(llm: LlmAgent, input: EvaluationInput): Promise<EvaluationResult> {
  const objective = computeObjectiveMetrics(input);
  try {
    const raw = await llm.chat(buildEvaluationPrompt(input), {
      signal: new AbortController().signal,
      maxTokens: 800,
      json: true,
    });
    const parsed = parseEvaluationOutput(raw);
    if (parsed.ok) {
      return { pillars: parsed.value.pillars, objective, summary: parsed.value.summary };
    }
  } catch {
    // rơi xuống nhánh mặc định bên dưới
  }
  return { pillars: null, objective, summary: "Không tạo được nhận xét tự động." };
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- evaluation`
Expected: PASS (4 test)

- [ ] **Step 5: Commit**

```bash
git add src/interview/evaluation/evaluation.ts src/interview/evaluation/evaluation.test.ts
git commit -m "feat(interview): add end-of-interview evaluation builder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 12: Cập nhật `Problems` (2 trường mới + test ẩn) + tạo bảng `InterviewSessions`

**Files:**
- Modify: `database/setup-dynamodb.sh`
- Modify: `database/dynamodb-tables.json`
- Modify: `database/README-DYNAMODB.md`
- Create: `database/interview-sessions-table.json`
- Create: `database/setup-interview-sessions-table.sh`
- Create: `infra/dynamodb-local/docker-compose.yml`

**Interfaces:**
- Produces: bảng `Problems` (local) có `hidden_constraints`, `follow_up_topics`, và mỗi đề ≥ 5 test ẩn; bảng `InterviewSessions` tồn tại với GSI `user-sessions-index` — dùng ở Task 13.

- [ ] **Step 1: Thêm `infra/dynamodb-local/docker-compose.yml`**

```yaml
services:
  dynamodb-local:
    image: amazon/dynamodb-local:2.5.2
    command: ["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"]
    ports:
      - "8000:8000"
```

- [ ] **Step 2: Khởi động DynamoDB Local**

Run: `docker compose -f infra/dynamodb-local/docker-compose.yml up -d`
Expected: container `dynamodb-local` chạy, cổng 8000 mở (kiểm bằng `curl -s http://localhost:8000` — nhận lỗi HTTP 400 từ DynamoDB Local, không phải "connection refused", nghĩa là đã chạy).

- [ ] **Step 3: Sửa `database/setup-dynamodb.sh` — thêm ràng buộc ẩn + test ẩn cho Two Sum**

Dùng Edit, tìm đúng khối `put-item` của `prob_1` và thay bằng bản có thêm `hidden_constraints`, `follow_up_topics`, và 4 test ẩn mới (id 4-7):

Old:
```bash
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_1"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "PROBLEM"},
        "title": {"S": "Two Sum"},
        "description": {"S": "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nExample:\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]"},
        "difficulty": {"S": "EASY"},
        "category": {"S": "Array"},
        "starter_code": {"S": "def two_sum(nums, target):\n    # Write your code here\n    pass"},
        "test_cases": {"L": [
            {"M": {"id": {"N": "1"}, "input": {"S": "[2,7,11,15]\n9"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "2"}, "input": {"S": "[3,2,4]\n6"}, "output": {"S": "[1,2]"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "3"}, "input": {"S": "[3,3]\n6"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": false}}}
        ]},
        "created_at": {"S": "2026-09-07T10:10:00Z"}
    }'
```

New:
```bash
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_1"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "PROBLEM"},
        "title": {"S": "Two Sum"},
        "description": {"S": "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nExample:\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]"},
        "difficulty": {"S": "EASY"},
        "category": {"S": "Array"},
        "starter_code": {"S": "def two_sum(nums, target):\n    # Write your code here\n    pass"},
        "test_cases": {"L": [
            {"M": {"id": {"N": "1"}, "input": {"S": "[2,7,11,15]\n9"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "2"}, "input": {"S": "[3,2,4]\n6"}, "output": {"S": "[1,2]"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "3"}, "input": {"S": "[3,3]\n6"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "4"}, "input": {"S": "[-1,-2,-3,-4,-5]\n-8"}, "output": {"S": "[2,4]"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "5"}, "input": {"S": "[0,4,3,0]\n0"}, "output": {"S": "[0,3]"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "6"}, "input": {"S": "[2,5,5,11]\n10"}, "output": {"S": "[1,2]"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "7"}, "input": {"S": "[1000000000,999999999,1,2]\n1999999999"}, "output": {"S": "[0,1]"}, "is_sample": {"BOOL": false}}}
        ]},
        "hidden_constraints": {"L": [
            {"S": "Mảng có thể chứa số âm"},
            {"S": "Đề bài đảm bảo luôn có đúng một đáp án"},
            {"S": "Không được dùng một phần tử hai lần"},
            {"S": "Độ dài mảng tối đa 10^5 phần tử"}
        ]},
        "follow_up_topics": {"L": [
            {"S": "Nếu mảng đã được sắp xếp sẵn thì tối ưu thế nào?"},
            {"S": "Nếu dữ liệu quá lớn không vừa RAM một máy thì xử lý ra sao?"},
            {"S": "Nếu cần trả về tất cả các cặp thỏa mãn thì sao?"}
        ]},
        "created_at": {"S": "2026-09-07T10:10:00Z"}
    }'
```

- [ ] **Step 4: Sửa khối `put-item` của `prob_2` (Valid Palindrome) tương tự**

Old:
```bash
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_2"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "PROBLEM"},
        "title": {"S": "Valid Palindrome"},
        "description": {"S": "Given a string s, return true if it is a palindrome, or false otherwise.\n\nExample:\nInput: s = \"A man, a plan, a canal: Panama\"\nOutput: true"},
        "difficulty": {"S": "EASY"},
        "category": {"S": "String"},
        "starter_code": {"S": "def is_palindrome(s: str) -> bool:\n    # Write your code here\n    pass"},
        "test_cases": {"L": [
            {"M": {"id": {"N": "1"}, "input": {"S": "A man, a plan, a canal: Panama"}, "output": {"S": "true"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "2"}, "input": {"S": "race a car"}, "output": {"S": "false"}, "is_sample": {"BOOL": true}}}
        ]},
        "created_at": {"S": "2026-09-07T10:15:00Z"}
    }'
```

New:
```bash
aws dynamodb put-item "${EXTRA_ARGS[@]}" \
    --table-name Problems \
    --item '{
        "problem_id": {"S": "prob_2"},
        "sk": {"S": "METADATA"},
        "entity_type": {"S": "PROBLEM"},
        "title": {"S": "Valid Palindrome"},
        "description": {"S": "Given a string s, return true if it is a palindrome, or false otherwise.\n\nExample:\nInput: s = \"A man, a plan, a canal: Panama\"\nOutput: true"},
        "difficulty": {"S": "EASY"},
        "category": {"S": "String"},
        "starter_code": {"S": "def is_palindrome(s: str) -> bool:\n    # Write your code here\n    pass"},
        "test_cases": {"L": [
            {"M": {"id": {"N": "1"}, "input": {"S": "A man, a plan, a canal: Panama"}, "output": {"S": "true"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "2"}, "input": {"S": "race a car"}, "output": {"S": "false"}, "is_sample": {"BOOL": true}}},
            {"M": {"id": {"N": "3"}, "input": {"S": ""}, "output": {"S": "true"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "4"}, "input": {"S": "a"}, "output": {"S": "true"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "5"}, "input": {"S": "Was it a car or a cat I saw?"}, "output": {"S": "true"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "6"}, "input": {"S": "Able , was I ere I saw Elba"}, "output": {"S": "true"}, "is_sample": {"BOOL": false}}},
            {"M": {"id": {"N": "7"}, "input": {"S": "Not a palindrome at all"}, "output": {"S": "false"}, "is_sample": {"BOOL": false}}}
        ]},
        "hidden_constraints": {"L": [
            {"S": "Chuỗi có thể rỗng"},
            {"S": "Chỉ so sánh chữ cái và chữ số, bỏ qua ký tự khác"},
            {"S": "Không phân biệt chữ hoa/thường"},
            {"S": "Độ dài chuỗi tối đa 10^5 ký tự"}
        ]},
        "follow_up_topics": {"L": [
            {"S": "Nếu chuỗi rất lớn, không thể load hết vào bộ nhớ thì sao?"},
            {"S": "Nếu cần hỗ trợ Unicode/tiếng Việt có dấu thì xử lý thế nào?"},
            {"S": "Nếu cho phép bỏ qua tối đa 1 ký tự để vẫn coi là palindrome thì giải thế nào?"}
        ]},
        "created_at": {"S": "2026-09-07T10:15:00Z"}
    }'
```

- [ ] **Step 5: Chạy script với DynamoDB Local, kiểm tra dữ liệu**

Run:
```bash
ENDPOINT_URL="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local ./database/setup-dynamodb.sh
aws dynamodb get-item --endpoint-url http://localhost:8000 --table-name Problems \
  --key '{"problem_id":{"S":"prob_1"},"sk":{"S":"METADATA"}}' \
  --query 'Item.hidden_constraints'
```
Expected: script chạy xong không lỗi; lệnh `get-item` in ra danh sách 4 ràng buộc ẩn.

- [ ] **Step 6: Sửa `database/dynamodb-tables.json` — thêm 2 trường tùy chọn vào `EntitySchemas.ProblemMetadata`**

Old:
```json
          "test_cases": [
            {
              "id": "Number",
              "input": "String",
              "output": "String",
              "is_sample": "Boolean"
            }
          ],
          "created_at": "String (ISO 8601 Timestamp)"
```

New:
```json
          "test_cases": [
            {
              "id": "Number",
              "input": "String",
              "output": "String",
              "is_sample": "Boolean"
            }
          ],
          "hidden_constraints": "List<String> (tùy chọn — ràng buộc cố tình giấu ứng viên, chỉ AI đọc để tiết lộ dần)",
          "follow_up_topics": "List<String> (tùy chọn — câu hỏi mở rộng dùng ở chặng 5)",
          "created_at": "String (ISO 8601 Timestamp)"
```

- [ ] **Step 7: Sửa `database/README-DYNAMODB.md` — thêm ghi chú 2 trường mới**

Thêm đoạn sau ngay dưới mục "3.1. Item Đề bài" (sau khối code ví dụ JSON):

```markdown
> **Cập nhật cho module AI Interviewer:** đề bài có thêm 2 trường tùy chọn `hidden_constraints` (danh sách ràng buộc cố tình giấu ứng viên, AI chỉ tiết lộ khi ứng viên hỏi trúng) và `follow_up_topics` (danh sách câu hỏi mở rộng dùng ở chặng phản biện). Đề nào chưa có 2 trường này thì AI tự suy ra từ mô tả đề. Hai trường này **không bao giờ** trả về cho frontend.
```

- [ ] **Step 8: Tạo `database/interview-sessions-table.json`**

```json
{
  "TableName": "InterviewSessions",
  "AttributeDefinitions": [
    { "AttributeName": "session_id", "AttributeType": "S" },
    { "AttributeName": "sk", "AttributeType": "S" },
    { "AttributeName": "user_id", "AttributeType": "S" },
    { "AttributeName": "started_at", "AttributeType": "S" }
  ],
  "KeySchema": [
    { "AttributeName": "session_id", "KeyType": "HASH" },
    { "AttributeName": "sk", "KeyType": "RANGE" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "user-sessions-index",
      "KeySchema": [
        { "AttributeName": "user_id", "KeyType": "HASH" },
        { "AttributeName": "started_at", "KeyType": "RANGE" }
      ],
      "Projection": { "ProjectionType": "ALL" }
    }
  ],
  "BillingMode": "PAY_PER_REQUEST",
  "Description": "Single-Table Design cho một buổi phỏng vấn AI Interviewer. PK: session_id (HASH) + sk (RANGE). sk: META | TURN#<iso>#<seq> | CODE#<iso> | RUN#<iso> | BOARD#<stage> | EVAL. GSI user-sessions-index (sparse, chỉ item META có user_id) tra lịch sử phỏng vấn theo user_id."
}
```

- [ ] **Step 9: Tạo `database/setup-interview-sessions-table.sh`**

```bash
#!/usr/bin/env bash
# =============================================================================
# Khởi tạo bảng DynamoDB `InterviewSessions` cho module AI Interviewer.
# Single-Table Design: META, TURN#, CODE#, RUN#, BOARD#, EVAL trong cùng 1 bảng.
# Usage:
#   chmod +x setup-interview-sessions-table.sh && ./setup-interview-sessions-table.sh
#   ENDPOINT_URL="http://localhost:8000" ./setup-interview-sessions-table.sh   # DynamoDB Local
# =============================================================================
set -e

REGION="${AWS_REGION:-us-east-1}"
EXTRA_ARGS=()

if [ -n "$ENDPOINT_URL" ]; then
    EXTRA_ARGS+=(--endpoint-url "$ENDPOINT_URL")
    echo "[*] Connecting to Endpoint: $ENDPOINT_URL"
else
    EXTRA_ARGS+=(--region "$REGION")
    echo "[*] Using AWS Region: $REGION"
fi

echo "=========================================================="
echo "CREATING TABLE 'InterviewSessions'..."
echo "=========================================================="

aws dynamodb create-table "${EXTRA_ARGS[@]}" \
    --table-name InterviewSessions \
    --attribute-definitions \
        AttributeName=session_id,AttributeType=S \
        AttributeName=sk,AttributeType=S \
        AttributeName=user_id,AttributeType=S \
        AttributeName=started_at,AttributeType=S \
    --key-schema \
        AttributeName=session_id,KeyType=HASH \
        AttributeName=sk,KeyType=RANGE \
    --global-secondary-indexes '[
        {
            "IndexName": "user-sessions-index",
            "KeySchema": [
                {"AttributeName": "user_id", "KeyType": "HASH"},
                {"AttributeName": "started_at", "KeyType": "RANGE"}
            ],
            "Projection": {"ProjectionType": "ALL"}
        }
    ]' \
    --billing-mode PAY_PER_REQUEST || echo "Table InterviewSessions may already exist, continuing..."

echo ""
echo "Waiting for table InterviewSessions to become ACTIVE..."
if [ -z "$ENDPOINT_URL" ]; then
    aws dynamodb wait table-exists --table-name InterviewSessions "${EXTRA_ARGS[@]}"
fi

echo "[SUCCESS] InterviewSessions table ready."
```

- [ ] **Step 10: Chạy script, xác nhận bảng tồn tại**

Run:
```bash
chmod +x database/setup-interview-sessions-table.sh
ENDPOINT_URL="http://localhost:8000" AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local ./database/setup-interview-sessions-table.sh
aws dynamodb describe-table --endpoint-url http://localhost:8000 --table-name InterviewSessions --query 'Table.TableStatus'
```
Expected: in ra `"ACTIVE"`

- [ ] **Step 11: Commit**

```bash
git add database/setup-dynamodb.sh database/dynamodb-tables.json database/README-DYNAMODB.md database/interview-sessions-table.json database/setup-interview-sessions-table.sh infra/dynamodb-local/docker-compose.yml
git commit -m "feat(db): add hidden constraints/follow-up topics and InterviewSessions table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 13: Persistence — ProblemRepository + InterviewRepository

> Test tích hợp trong task này cần DynamoDB Local đang chạy và dữ liệu đã seed (đã làm ở Task 12, Step 2 và Step 5/10). Nếu container chưa chạy: `docker compose -f infra/dynamodb-local/docker-compose.yml up -d`.

**Files:**
- Create: `src/interview/persistence/ddb-client.ts`
- Create: `src/interview/persistence/problem-repository.ts`
- Create: `src/interview/persistence/problem-repository.test.ts`
- Create: `src/interview/persistence/interview-repository.ts`
- Create: `src/interview/persistence/interview-repository.test.ts`

**Interfaces:**
- Consumes: `Problem`, `Turn`, `CodeRunResult`, `WhiteboardState`, `EvaluationResult`, `SessionMetaItem`, `Stage`, `Language` (Task 2).
- Produces: `createDdbClient(): DynamoDBDocumentClient`, `ProblemRepository` (`getProblem`, `getRandomProblemId`), `ProblemNotFoundError`, `InterviewRepository` (`createMeta`, `updateMeta`, `putTurn`, `putCodeSnapshot`, `putRun`, `putBoard`, `putEvaluation`, `getSessionReport`), `SessionReport` type — dùng ở Task 15 (runtime), Task 16 (WsGateway), Task 17 (REST).

- [ ] **Step 1: Viết `src/interview/persistence/ddb-client.ts`**

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function createDdbClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "ap-southeast-1",
    ...(process.env.DDB_ENDPOINT ? { endpoint: process.env.DDB_ENDPOINT } : {}),
  });
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}
```

- [ ] **Step 2: Viết test cho `ProblemRepository`**

```ts
// src/interview/persistence/problem-repository.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ProblemRepository, ProblemNotFoundError } from "./problem-repository";

function localDdb(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
}

describe("ProblemRepository (DynamoDB Local)", () => {
  const repo = new ProblemRepository(localDdb(), "Problems");

  it("getProblem trả về đúng item METADATA kèm hidden_constraints", async () => {
    const problem = await repo.getProblem("prob_1");
    expect(problem.title).toBe("Two Sum");
    expect(problem.hidden_constraints?.length).toBeGreaterThan(0);
    expect(problem.test_cases.filter((t) => !t.is_sample).length).toBeGreaterThanOrEqual(5);
  });

  it("getProblem ném ProblemNotFoundError khi id không tồn tại", async () => {
    await expect(repo.getProblem("prob_does_not_exist")).rejects.toBeInstanceOf(ProblemNotFoundError);
  });

  it("getRandomProblemId trả về 1 trong các id đã seed", async () => {
    const id = await repo.getRandomProblemId();
    expect(["prob_1", "prob_2"]).toContain(id);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- problem-repository`
Expected: FAIL — module `./problem-repository` không tồn tại

- [ ] **Step 4: Viết `src/interview/persistence/problem-repository.ts`**

```ts
import { GetCommand, ScanCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Problem } from "../domain/types";

export class ProblemNotFoundError extends Error {
  constructor(problemId: string) {
    super(`Problem not found: ${problemId}`);
    this.name = "ProblemNotFoundError";
  }
}

export class ProblemRepository {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private tableName: string = process.env.DDB_PROBLEMS_TABLE ?? "Problems",
  ) {}

  async getProblem(problemId: string): Promise<Problem> {
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.tableName, Key: { problem_id: problemId, sk: "METADATA" } }),
    );
    if (!res.Item) throw new ProblemNotFoundError(problemId);
    return res.Item as Problem;
  }

  async getRandomProblemId(): Promise<string> {
    const res = await this.ddb.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "sk = :sk",
        ExpressionAttributeValues: { ":sk": "METADATA" },
        ProjectionExpression: "problem_id",
      }),
    );
    const items = res.Items ?? [];
    if (items.length === 0) throw new Error("No problems found in table");
    return items[Math.floor(Math.random() * items.length)].problem_id as string;
  }
}
```

- [ ] **Step 5: Chạy test, xác nhận pass** (cần DynamoDB Local đã seed từ Task 12)

Run: `npm test -- problem-repository`
Expected: PASS (3 test)

- [ ] **Step 6: Viết test cho `InterviewRepository`**

```ts
// src/interview/persistence/interview-repository.test.ts
import { describe, it, expect } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { InterviewRepository } from "./interview-repository";
import type { SessionMetaItem, Turn } from "../domain/types";

function localDdb(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
}

function meta(sessionId: string): SessionMetaItem {
  return {
    session_id: sessionId,
    sk: "META",
    problem_id: "prob_1",
    language: "python",
    token_hash: "hash123",
    status: "active",
    current_stage: 1,
    started_at: new Date().toISOString(),
    model_versions: { qwen: "fake", stt: "fake", tts: "fake" },
  };
}

function turn(id: string, createdAt: string): Turn {
  return {
    turnId: id,
    role: "ai",
    stage: 1,
    trigger: "stage_enter",
    text: `turn ${id}`,
    action: "speak",
    interrupted: false,
    createdAt,
  };
}

describe("InterviewRepository (DynamoDB Local)", () => {
  const repo = new InterviewRepository(localDdb(), "InterviewSessions");

  it("createMeta rồi getSessionReport trả về đúng meta", async () => {
    const sessionId = `ses_test_${Date.now()}_meta`;
    await repo.createMeta(meta(sessionId));
    const report = await repo.getSessionReport(sessionId);
    expect(report.meta?.problem_id).toBe("prob_1");
    expect(report.meta?.status).toBe("active");
  });

  it("updateMeta cập nhật status và current_stage", async () => {
    const sessionId = `ses_test_${Date.now()}_update`;
    await repo.createMeta(meta(sessionId));
    await repo.updateMeta(sessionId, { status: "completed", current_stage: 6 });
    const report = await repo.getSessionReport(sessionId);
    expect(report.meta?.status).toBe("completed");
    expect(report.meta?.current_stage).toBe(6);
  });

  it("putTurn nhiều lần trả về đúng thứ tự thời gian trong getSessionReport", async () => {
    const sessionId = `ses_test_${Date.now()}_turns`;
    await repo.createMeta(meta(sessionId));
    await repo.putTurn(sessionId, turn("t1", "2026-09-14T10:00:00.000Z"));
    await repo.putTurn(sessionId, turn("t2", "2026-09-14T10:00:05.000Z"));
    const report = await repo.getSessionReport(sessionId);
    expect(report.turns.map((t) => t.turnId)).toEqual(["t1", "t2"]);
  });

  it("putRun, putBoard, putEvaluation đều đọc lại được qua getSessionReport", async () => {
    const sessionId = `ses_test_${Date.now()}_extras`;
    await repo.createMeta(meta(sessionId));
    await repo.putCodeSnapshot(sessionId, 3, "print(1)", "python");
    await repo.putRun(sessionId, 3, { runId: "r1", mode: "sample", status: "OK", tests: [] });
    await repo.putBoard(sessionId, 5, { nodes: [], edges: [] });
    await repo.putEvaluation(sessionId, {
      pillars: null,
      objective: {
        hidden_tests_passed: 0, hidden_tests_total: 0, constraints_clarified: 0, constraints_total: 0,
        hints_given: 0, code_runs: 1, interruptions: 0, stage_durations_sec: {}, forced_transitions: [],
      },
      summary: "test",
    });
    const report = await repo.getSessionReport(sessionId);
    expect(report.codeRuns[0].runId).toBe("r1");
    expect(report.boards[0].stage).toBe(5);
    expect(report.evaluation?.summary).toBe("test");
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận fail**

Run: `npm test -- interview-repository`
Expected: FAIL — module `./interview-repository` không tồn tại

- [ ] **Step 8: Viết `src/interview/persistence/interview-repository.ts`**

```ts
import { PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type {
  CodeRunResult, EvaluationResult, Language, SessionMetaItem, Stage, Turn, WhiteboardState,
} from "../domain/types";

export interface SessionReport {
  meta: SessionMetaItem | null;
  turns: Turn[];
  codeRuns: CodeRunResult[];
  boards: Array<{ stage: Stage; board: WhiteboardState }>;
  evaluation: EvaluationResult | null;
}

export class InterviewRepository {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private tableName: string = process.env.DDB_SESSIONS_TABLE ?? "InterviewSessions",
  ) {}

  async createMeta(meta: SessionMetaItem): Promise<void> {
    await this.ddb.send(new PutCommand({ TableName: this.tableName, Item: meta }));
  }

  async updateMeta(sessionId: string, patch: Partial<Omit<SessionMetaItem, "session_id" | "sk">>): Promise<void> {
    const entries = Object.entries(patch);
    if (entries.length === 0) return;
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets = entries.map(([key, value]) => {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      return `#${key} = :${key}`;
    });
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { session_id: sessionId, sk: "META" },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async putTurn(sessionId: string, turn: Turn): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `TURN#${turn.createdAt}#${turn.turnId}`, ...turn },
      }),
    );
  }

  async putCodeSnapshot(sessionId: string, stage: Stage, code: string, language: Language): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `CODE#${new Date().toISOString()}`, stage, code, language },
      }),
    );
  }

  async putRun(sessionId: string, stage: Stage, run: CodeRunResult): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `RUN#${new Date().toISOString()}`, stage, ...run },
      }),
    );
  }

  async putBoard(sessionId: string, stage: Stage, board: WhiteboardState): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `BOARD#${stage}`, stage, ...board },
      }),
    );
  }

  async putEvaluation(sessionId: string, evaluation: EvaluationResult): Promise<void> {
    await this.ddb.send(
      new PutCommand({ TableName: this.tableName, Item: { session_id: sessionId, sk: "EVAL", ...evaluation } }),
    );
  }

  async getSessionReport(sessionId: string): Promise<SessionReport> {
    const res = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "session_id = :sid",
        ExpressionAttributeValues: { ":sid": sessionId },
      }),
    );
    const items = res.Items ?? [];
    const meta = (items.find((i) => i.sk === "META") as SessionMetaItem | undefined) ?? null;
    const turns = items.filter((i) => (i.sk as string).startsWith("TURN#")) as unknown as Turn[];
    const codeRuns = items.filter((i) => (i.sk as string).startsWith("RUN#")) as unknown as CodeRunResult[];
    const boards = items
      .filter((i) => (i.sk as string).startsWith("BOARD#"))
      .map((i) => ({ stage: i.stage as Stage, board: { nodes: i.nodes, edges: i.edges } as WhiteboardState }));
    const evalItem = items.find((i) => i.sk === "EVAL");
    const evaluation = evalItem ? (evalItem as unknown as EvaluationResult) : null;
    return { meta, turns, codeRuns, boards, evaluation };
  }
}
```

- [ ] **Step 9: Chạy test, xác nhận pass**

Run: `npm test -- interview-repository`
Expected: PASS (4 test)

- [ ] **Step 10: Commit**

```bash
git add src/interview/persistence/
git commit -m "feat(interview): add DynamoDB persistence for problems and interview sessions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 14: Hạ tầng Judge0 (local + EC2) + Judge0Executor thật

**Files:**
- Create: `infra/judge0/docker-compose.yml`
- Create: `infra/judge0/judge0.conf.example`
- Create: `infra/judge0/setup-ec2.sh`
- Create: `src/interview/agents/judge0-executor.ts`
- Create: `src/interview/agents/judge0-executor.test.ts`

**Interfaces:**
- Consumes: `CodeExecutor`, `ExecutionResult` (Task 6), `Language` (Task 2).
- Produces: `Judge0Executor` class, `mapJudge0Result(body, expectedOutput)`, `LANGUAGE_TO_JUDGE0_ID` — dùng ở Task 15 (runtime).

- [ ] **Step 1: Tạo `infra/judge0/judge0.conf.example`**

```
POSTGRES_HOST=db
POSTGRES_DB=judge0
POSTGRES_USER=judge0
POSTGRES_PASSWORD=doi_mat_khau_nay
REDIS_HOST=redis
REDIS_PASSWORD=doi_mat_khau_redis_nay
RAILS_MAX_THREADS=10
MAX_QUEUE_SIZE=100
ENABLE_WAIT_RESULT=true
ENABLE_COMPILER_OPTIONS=false
MAX_CPU_TIME_LIMIT=15
MAX_CPU_EXTRA_TIME=5
MAX_WALL_TIME_LIMIT=20
MAX_MEMORY_LIMIT=512000
MAX_STACK_LIMIT=128000
MAX_PROCESSES_AND_OR_THREADS=120
MAX_NUMBER_OF_RUNS=20
```

- [ ] **Step 2: Tạo `infra/judge0/docker-compose.yml`**

```yaml
services:
  server:
    image: judge0/judge0:1.13.0
    volumes:
      - ./judge0.conf:/judge0.conf:ro
    ports:
      - "2358:2358"
    privileged: true
    env_file: judge0.conf
    restart: always
    depends_on:
      - db
      - redis

  workers:
    image: judge0/judge0:1.13.0
    command: ["./scripts/workers"]
    volumes:
      - ./judge0.conf:/judge0.conf:ro
    privileged: true
    env_file: judge0.conf
    restart: always
    depends_on:
      - db
      - redis

  db:
    image: postgres:16.2
    env_file: judge0.conf
    volumes:
      - judge0-db-data:/var/lib/postgresql/data/
    restart: always

  redis:
    image: redis:7.2.4
    command: ["bash", "-c", "docker-entrypoint.sh --appendonly no --requirepass \"$$REDIS_PASSWORD\""]
    env_file: judge0.conf
    restart: always

volumes:
  judge0-db-data:
```

- [ ] **Step 3: Tạo `infra/judge0/setup-ec2.sh`** (chạy 1 lần trên EC2 Ubuntu 22.04, không chạy trên máy dev)

```bash
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
```

- [ ] **Step 4: Chạy Judge0 ở máy dev để test (dùng cấu hình mặc định, không cần sửa mật khẩu vì chỉ chạy local)**

Run:
```bash
cd infra/judge0
cp judge0.conf.example judge0.conf
docker compose up -d
sleep 15
curl -s http://localhost:2358/about
```
Expected: JSON trả về thông tin phiên bản Judge0 (không lỗi kết nối).

- [ ] **Step 5: Viết test cho `mapJudge0Result` (thuần, không cần Judge0 chạy)**

```ts
// src/interview/agents/judge0-executor.test.ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { Judge0Executor, mapJudge0Result } from "./judge0-executor";

describe("mapJudge0Result", () => {
  it("status id 3 (Accepted) với expectedOutput -> OK, passed true", () => {
    const r = mapJudge0Result({ status: { id: 3, description: "Accepted" }, stdout: "5\n", stderr: null, compile_output: null, time: "0.012" }, "5");
    expect(r).toEqual({ status: "OK", stdout: "5", stderr: "", timeMs: 12, passed: true });
  });

  it("status id 4 (Wrong Answer) -> OK, passed false", () => {
    const r = mapJudge0Result({ status: { id: 4, description: "Wrong Answer" }, stdout: "6\n", stderr: null, compile_output: null, time: "0.01" }, "5");
    expect(r.status).toBe("OK");
    expect(r.passed).toBe(false);
  });

  it("không truyền expectedOutput -> passed undefined", () => {
    const r = mapJudge0Result({ status: { id: 3, description: "Accepted" }, stdout: "5\n", stderr: null, compile_output: null, time: "0.01" });
    expect(r.passed).toBeUndefined();
  });

  it("status id 5 (Time Limit Exceeded) -> TIME_LIMIT", () => {
    const r = mapJudge0Result({ status: { id: 5, description: "Time Limit Exceeded" }, stdout: null, stderr: null, compile_output: null, time: null });
    expect(r.status).toBe("TIME_LIMIT");
  });

  it("status id 6 (Compilation Error) -> COMPILE_ERROR, dùng compile_output làm stderr", () => {
    const r = mapJudge0Result({ status: { id: 6, description: "Compilation Error" }, stdout: null, stderr: null, compile_output: "SyntaxError", time: null });
    expect(r.status).toBe("COMPILE_ERROR");
    expect(r.stderr).toBe("SyntaxError");
  });

  it("status id 11 (Runtime Error SIGSEGV) -> RUNTIME_ERROR", () => {
    const r = mapJudge0Result({ status: { id: 11, description: "Runtime Error (SIGSEGV)" }, stdout: null, stderr: "boom", compile_output: null, time: "0.01" });
    expect(r.status).toBe("RUNTIME_ERROR");
  });
});

describe("Judge0Executor.run — lỗi mạng (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trả EXECUTOR_UNAVAILABLE khi fetch ném lỗi", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({ language: "python", code: "print(1)", stdin: "", signal: new AbortController().signal });
    expect(res.status).toBe("EXECUTOR_UNAVAILABLE");
  });

  it("trả EXECUTOR_UNAVAILABLE khi response không ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({ language: "python", code: "print(1)", stdin: "", signal: new AbortController().signal });
    expect(res.status).toBe("EXECUTOR_UNAVAILABLE");
  });

  it("parse đúng response thành công (mock)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: { id: 3, description: "Accepted" }, stdout: "2\n", stderr: null, compile_output: null, time: "0.01" }),
      }),
    );
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({ language: "python", code: "print(1+1)", stdin: "", expectedOutput: "2", signal: new AbortController().signal });
    expect(res).toEqual({ status: "OK", stdout: "2", stderr: "", timeMs: 10, passed: true });
  });
});

describe("Judge0Executor.run — tích hợp thật (cần Judge0 đang chạy tại localhost:2358)", () => {
  it("chạy code Python thật và nhận kết quả đúng", async () => {
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({
      language: "python", code: "print(1 + 1)", stdin: "", expectedOutput: "2", signal: new AbortController().signal,
    });
    expect(res.status).toBe("OK");
    expect(res.passed).toBe(true);
  });

  it("báo COMPILE_ERROR với code Python sai cú pháp", async () => {
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({
      language: "python", code: "def f(:\n  pass", stdin: "", signal: new AbortController().signal,
    });
    expect(res.status).toBe("COMPILE_ERROR");
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận fail**

Run: `npm test -- judge0-executor`
Expected: FAIL — module `./judge0-executor` không tồn tại

- [ ] **Step 7: Viết `src/interview/agents/judge0-executor.ts`**

```ts
import type { CodeExecutor, ExecutionResult } from "./types";
import type { Language } from "../domain/types";

export const LANGUAGE_TO_JUDGE0_ID: Record<Language, number> = {
  python: 71,
  javascript: 63,
  cpp: 54,
};

interface Judge0SubmissionResult {
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null;
}

export function mapJudge0Result(body: Judge0SubmissionResult, expectedOutput?: string): ExecutionResult {
  const timeMs = body.time ? Math.round(parseFloat(body.time) * 1000) : 0;
  const stdout = (body.stdout ?? "").replace(/\s+$/, "");
  const stderr = body.stderr ?? body.compile_output ?? "";
  if (body.status.id === 6) return { status: "COMPILE_ERROR", stdout, stderr, timeMs };
  if (body.status.id === 5) return { status: "TIME_LIMIT", stdout, stderr, timeMs };
  if (body.status.id >= 7 && body.status.id <= 12) return { status: "RUNTIME_ERROR", stdout, stderr, timeMs };
  const passed = expectedOutput !== undefined ? body.status.id === 3 : undefined;
  return { status: "OK", stdout, stderr, timeMs, passed };
}

export class Judge0Executor implements CodeExecutor {
  constructor(private baseUrl: string) {}

  async run(req: {
    language: Language; code: string; stdin: string; expectedOutput?: string; signal: AbortSignal;
  }): Promise<ExecutionResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/submissions?base64_encoded=false&wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_code: req.code,
          language_id: LANGUAGE_TO_JUDGE0_ID[req.language],
          stdin: req.stdin,
          expected_output: req.expectedOutput,
          cpu_time_limit: 2,
          memory_limit: 256000,
        }),
        signal: req.signal,
      });
    } catch {
      return { status: "EXECUTOR_UNAVAILABLE", stdout: "", stderr: "", timeMs: 0 };
    }
    if (!res.ok) return { status: "EXECUTOR_UNAVAILABLE", stdout: "", stderr: "", timeMs: 0 };
    const body = (await res.json()) as Judge0SubmissionResult;
    return mapJudge0Result(body, req.expectedOutput);
  }
}
```

- [ ] **Step 8: Chạy test, xác nhận pass** (cần Judge0 đang chạy từ Step 4 cho 2 test tích hợp cuối)

Run: `npm test -- judge0-executor`
Expected: PASS (11 test)

- [ ] **Step 9: Commit**

```bash
git add infra/judge0/ src/interview/agents/judge0-executor.ts src/interview/agents/judge0-executor.test.ts
git commit -m "feat(interview): add Judge0 infra and real CodeExecutor implementation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 15: Runtime wiring (`getInterviewRuntime`)

**Files:**
- Create: `src/interview/runtime.ts`
- Create: `src/interview/runtime.test.ts`

**Interfaces:**
- Consumes: `SessionManager` (Task 5), `SystemClock`/`Clock` (Task 3), `createDdbClient`/`ProblemRepository`/`InterviewRepository` (Task 13), `MetricsCollector` (Task 10), `Judge0Executor` (Task 14), `FakeLlmAgent`/`FakeSttAgent`/`FakeTtsAgent`/`FakeModelHealth` (Task 6).
- Produces: `InterviewRuntime` type, `getInterviewRuntime(): InterviewRuntime` (singleton qua `globalThis`, để REST route handler và WS server dùng chung dù Next.js có nạp thành 2 module instance khác nhau), `setInterviewRuntimeForTest`, `resetInterviewRuntimeForTest` — dùng ở Task 16, 17, 18, 19, 20.

- [ ] **Step 1: Viết test**

```ts
// src/interview/runtime.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { getInterviewRuntime, resetInterviewRuntimeForTest, setInterviewRuntimeForTest } from "./runtime";

describe("getInterviewRuntime", () => {
  afterEach(() => resetInterviewRuntimeForTest());

  it("trả về cùng một instance ở các lần gọi khác nhau (singleton)", () => {
    const a = getInterviewRuntime();
    const b = getInterviewRuntime();
    expect(a).toBe(b);
  });

  it("có đủ các thành phần cần thiết", () => {
    const runtime = getInterviewRuntime();
    expect(runtime.sessionManager).toBeDefined();
    expect(runtime.problemRepository).toBeDefined();
    expect(runtime.interviewRepository).toBeDefined();
    expect(runtime.agents.codeExecutor).toBeDefined();
    expect(runtime.agents.llm).toBeDefined();
  });

  it("setInterviewRuntimeForTest cho phép ép runtime tùy chỉnh, dùng lại được ở lần gọi sau", () => {
    const custom = getInterviewRuntime();
    resetInterviewRuntimeForTest();
    setInterviewRuntimeForTest(custom);
    expect(getInterviewRuntime()).toBe(custom);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- runtime.test`
Expected: FAIL — module `./runtime` không tồn tại

- [ ] **Step 3: Viết `src/interview/runtime.ts`**

```ts
import { SessionManager } from "./session/session-manager";
import { SystemClock, type Clock } from "./session/clock";
import { createDdbClient } from "./persistence/ddb-client";
import { ProblemRepository } from "./persistence/problem-repository";
import { InterviewRepository } from "./persistence/interview-repository";
import { MetricsCollector } from "./metrics/metrics";
import { Judge0Executor } from "./agents/judge0-executor";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeModelHealth } from "./agents/fakes";
import type { LlmAgent, SttAgent, TtsAgent, ModelHealth, CodeExecutor } from "./agents/types";

export interface InterviewRuntime {
  sessionManager: SessionManager;
  problemRepository: ProblemRepository;
  interviewRepository: InterviewRepository;
  metrics: MetricsCollector;
  clock: Clock;
  agents: { llm: LlmAgent; stt: SttAgent; tts: TtsAgent; codeExecutor: CodeExecutor; modelHealth: ModelHealth };
}

declare global {
  var __interviewRuntime: InterviewRuntime | undefined;
}

function buildRuntime(): InterviewRuntime {
  const ddb = createDdbClient();
  return {
    sessionManager: new SessionManager({ maxConcurrent: Number(process.env.MAX_CONCURRENT_SESSIONS ?? 2) }),
    problemRepository: new ProblemRepository(ddb),
    interviewRepository: new InterviewRepository(ddb),
    metrics: new MetricsCollector(),
    clock: new SystemClock(),
    // 3 agent AI dùng bản giả lập ở plan này — plan sau (SageMaker thật) chỉ cần thay 3 dòng dưới.
    agents: {
      llm: new FakeLlmAgent(),
      stt: new FakeSttAgent(),
      tts: new FakeTtsAgent(),
      codeExecutor: new Judge0Executor(process.env.JUDGE0_URL ?? "http://127.0.0.1:2358"),
      modelHealth: new FakeModelHealth(),
    },
  };
}

export function getInterviewRuntime(): InterviewRuntime {
  if (!globalThis.__interviewRuntime) {
    globalThis.__interviewRuntime = buildRuntime();
  }
  return globalThis.__interviewRuntime;
}

/** Chỉ dùng trong test: ép runtime bằng bản tùy chỉnh (ví dụ fake khác nhau giữa các test). */
export function setInterviewRuntimeForTest(runtime: InterviewRuntime): void {
  globalThis.__interviewRuntime = runtime;
}

export function resetInterviewRuntimeForTest(): void {
  globalThis.__interviewRuntime = undefined;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- runtime.test`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add src/interview/runtime.ts src/interview/runtime.test.ts
git commit -m "feat(interview): add runtime singleton wiring shared by REST and WS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 16: WsGateway — nối Session, EventRouter, TurnRunner, persistence qua WebSocket

**Files:**
- Create: `src/interview/ws/ws-gateway.ts`
- Create: `src/interview/ws/ws-gateway.test.ts`

**Interfaces:**
- Consumes: `Session`/`SessionManager` (Task 5), `Clock` (Task 3), `EventRouter`/`TriggerPayload` (Task 7), `TurnRunner`/`TurnOutputSink` (Task 9), `SpeechBuffer` (Task 9), `runTestSuite` (Task 6), `LlmAgent`/`SttAgent`/`TtsAgent`/`CodeExecutor` (Task 6), `InterviewRepository` (Task 13), `MetricsCollector` (Task 10), `buildEvaluation` (Task 11), `decodeClientMessage`/`encodeServerMessage`/`ServerMessage` (Task 2), `getStageConfig` (Task 3), `StageMachineEvent` (Task 4).
- Produces: `attachWsGateway(ws, url, deps): void`, `hashToken(token): string`, `WsGatewayDeps` type — dùng ở Task 18 (server.ts).

Đây là task tích hợp, không tránh khỏi dài — nhưng vẫn là **một** đơn vị review hợp lý vì toàn bộ logic chỉ để trả lời đúng một câu hỏi: "một kết nối WS của một phiên hoạt động thế nào từ lúc mở tới lúc đóng".

- [ ] **Step 1: Viết test tích hợp (dùng server `ws` thật trên cổng ngẫu nhiên, agent giả lập)**

```ts
// src/interview/ws/ws-gateway.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { attachWsGateway, hashToken, type WsGatewayDeps } from "./ws-gateway";
import { SessionManager } from "../session/session-manager";
import type { InterviewRepository } from "../persistence/interview-repository";
import { MetricsCollector } from "../metrics/metrics";
import { SystemClock } from "../session/clock";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeCodeExecutor } from "../agents/fakes";
import type { Problem } from "../domain/types";

const PROBLEM: Problem = {
  problem_id: "p1", title: "Two Sum", description: "d", difficulty: "EASY", category: "Array",
  starter_code: "", test_cases: [{ id: 1, input: "1", output: "2", is_sample: true }],
};

function noopRepo(): InterviewRepository {
  return {
    createMeta: async () => {}, updateMeta: async () => {}, putTurn: async () => {},
    putCodeSnapshot: async () => {}, putRun: async () => {}, putBoard: async () => {}, putEvaluation: async () => {},
    getSessionReport: async () => ({ meta: null, turns: [], codeRuns: [], boards: [], evaluation: null }),
  } as unknown as InterviewRepository;
}

async function startServer(deps: WsGatewayDeps) {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    attachWsGateway(ws, url, deps);
  });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  return { wss, port: (wss.address() as AddressInfo).port };
}

function collectMessages(ws: WebSocket, count: number): Promise<Array<{ type?: string; data?: unknown; binary?: boolean }>> {
  return new Promise((resolve) => {
    const msgs: Array<{ type?: string; data?: unknown; binary?: boolean }> = [];
    ws.on("message", (data, isBinary) => {
      msgs.push(isBinary ? { binary: true } : JSON.parse(data.toString()));
      if (msgs.length >= count) resolve(msgs);
    });
  });
}

function waitForType(ws: WebSocket, type: string): Promise<{ type: string; data: any }> {
  return new Promise((resolve) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === type) resolve(msg);
    });
  });
}

describe("WsGateway", () => {
  let sessionManager: SessionManager;
  let servers: WebSocketServer[];

  beforeEach(() => {
    sessionManager = new SessionManager({ maxConcurrent: 5 });
    servers = [];
  });

  afterEach(() => {
    for (const s of servers) s.close();
  });

  function makeDeps(overrides: Partial<{ llm: FakeLlmAgent }> = {}): WsGatewayDeps {
    return {
      sessionManager,
      interviewRepository: noopRepo(),
      metrics: new MetricsCollector(),
      clock: new SystemClock(),
      agents: {
        llm: overrides.llm ?? new FakeLlmAgent(),
        stt: new FakeSttAgent(),
        tts: new FakeTtsAgent(),
        codeExecutor: new FakeCodeExecutor(() => ({ status: "OK", stdout: "2", stderr: "", timeMs: 1, passed: true })),
      },
    };
  }

  it("gửi session.state ngay khi kết nối, rồi phát lượt mở đầu chặng qua TTS", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Chào bạn.", note: null, revealed_constraints: [], covered_topics: [] }));
    const deps = makeDeps({ llm });
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    sessionManager.create({ sessionId: "s1", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });

    const ws = new WebSocket(`ws://localhost:${port}/ws/session/s1?token=tok`);
    const messages = await collectMessages(ws, 5); // state, speech.start, reply, chunk(binary), speech.end
    ws.close();

    expect(messages.some((m) => m.type === "session.state" && (m.data as any).stage === 1)).toBe(true);
    expect(messages.some((m) => m.type === "ai.reply" && (m.data as any).text === "Chào bạn.")).toBe(true);
    expect(messages.some((m) => m.binary)).toBe(true);
  });

  it("đóng kết nối cũ với mã 4409 khi có kết nối mới cho cùng session", async () => {
    const deps = makeDeps();
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    sessionManager.create({ sessionId: "s2", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });

    const ws1 = new WebSocket(`ws://localhost:${port}/ws/session/s2?token=tok`);
    await new Promise((resolve) => ws1.once("open", resolve));
    const closeCode = new Promise((resolve) => ws1.once("close", resolve));
    const ws2 = new WebSocket(`ws://localhost:${port}/ws/session/s2?token=tok`);
    await new Promise((resolve) => ws2.once("open", resolve));
    expect(await closeCode).toBe(4409);
    ws2.close();
  });

  it("đóng kết nối với mã 4401 khi token sai", async () => {
    const deps = makeDeps();
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    sessionManager.create({ sessionId: "s3", tokenHash: hashToken("tok-dung"), problem: PROBLEM, language: "python", clock: deps.clock });
    const ws = new WebSocket(`ws://localhost:${port}/ws/session/s3?token=tok-sai`);
    const closeCode = await new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    expect(closeCode).toBe(4401);
  });

  it("stage.done ở chặng 3 bị từ chối khi chưa code.run lần nào", async () => {
    const deps = makeDeps();
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    const session = sessionManager.create({ sessionId: "s4", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });
    session.currentStage = 3;
    const ws = new WebSocket(`ws://localhost:${port}/ws/session/s4?token=tok`);
    await new Promise((resolve) => ws.once("open", resolve));
    const errorPromise = waitForType(ws, "error");
    ws.send(JSON.stringify({ type: "stage.done" }));
    const errMsg = await errorPromise;
    expect(errMsg.data.code).toBe("STAGE_PRECONDITION");
    ws.close();
  });

  it("code.run chạy qua CodeExecutor và trả code.result với test mẫu", async () => {
    const deps = makeDeps();
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    sessionManager.create({ sessionId: "s5", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });
    const ws = new WebSocket(`ws://localhost:${port}/ws/session/s5?token=tok`);
    await new Promise((resolve) => ws.once("open", resolve));
    const resultPromise = waitForType(ws, "code.result");
    ws.send(JSON.stringify({ type: "code.run" }));
    const resultMsg = await resultPromise;
    expect(resultMsg.data.mode).toBe("sample");
    expect(resultMsg.data.tests[0].passed).toBe(true);
    ws.close();
  });

  it("speech.start khi AI đang nói thì hủy lượt và gửi ai.speech.cancelled", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Câu một. Câu hai. Câu ba.", note: null, revealed_constraints: [], covered_topics: [] }));
    const deps = makeDeps({ llm });
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    sessionManager.create({ sessionId: "s6", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });
    const ws = new WebSocket(`ws://localhost:${port}/ws/session/s6?token=tok`);
    await waitForType(ws, "ai.speech.start");
    const cancelledPromise = waitForType(ws, "ai.speech.cancelled");
    ws.send(JSON.stringify({ type: "speech.start" }));
    const cancelled = await cancelledPromise;
    expect(cancelled.type).toBe("ai.speech.cancelled");
    ws.close();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npm test -- ws-gateway`
Expected: FAIL — module `./ws-gateway` không tồn tại

- [ ] **Step 3: Viết `src/interview/ws/ws-gateway.ts`**

```ts
import { randomUUID, createHash } from "node:crypto";
import type { WebSocket } from "ws";
import { Session } from "../session/session";
import type { SessionManager } from "../session/session-manager";
import type { Clock } from "../session/clock";
import type { StageMachineEvent } from "../session/stage-machine";
import { EventRouter, type TriggerPayload } from "../router/event-router";
import { TurnRunner, type TurnOutputSink } from "../turn/turn-runner";
import { SpeechBuffer } from "../turn/speech-buffer";
import { runTestSuite } from "../agents/code-runner";
import type { LlmAgent, SttAgent, TtsAgent, CodeExecutor } from "../agents/types";
import type { InterviewRepository } from "../persistence/interview-repository";
import type { MetricsCollector } from "../metrics/metrics";
import { buildEvaluation } from "../evaluation/evaluation";
import { decodeClientMessage, encodeServerMessage, type ServerMessage } from "../protocol/messages";
import type { CodeRunResult, TriggerType } from "../domain/types";
import { getStageConfig } from "../config/stages";

export interface WsGatewayDeps {
  sessionManager: SessionManager;
  interviewRepository: InterviewRepository;
  metrics: MetricsCollector;
  clock: Clock;
  agents: { llm: LlmAgent; stt: SttAgent; tts: TtsAgent; codeExecutor: CodeExecutor };
}

const connections = new Map<string, { ws: WebSocket; eventRouter: EventRouter; forcedTickTimer: unknown; clock: Clock }>();

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function attachWsGateway(ws: WebSocket, url: URL, deps: WsGatewayDeps): void {
  const match = url.pathname.match(/^\/ws\/session\/([^/]+)$/);
  const sessionId = match?.[1];
  const token = url.searchParams.get("token");
  if (!sessionId || !token) {
    ws.close(4404, "Session not found");
    return;
  }
  const session = deps.sessionManager.get(sessionId);
  if (!session || session.tokenHash !== hashToken(token)) {
    ws.close(4401, "Invalid token");
    return;
  }

  const existing = connections.get(sessionId);
  if (existing) {
    existing.eventRouter.dispose();
    existing.clock.clearTimeout(existing.forcedTickTimer);
    existing.ws.close(4409, "Replaced by new connection");
    connections.delete(sessionId);
  }

  const send = (msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(encodeServerMessage(msg));
  };

  const sendState = (): void => {
    const cfg = getStageConfig(session.currentStage);
    send({
      type: "session.state",
      data: {
        stage: session.currentStage,
        stageName: cfg.name,
        stageElapsedSec: session.stageElapsedSec,
        stageMinSec: cfg.minSec,
        stageMaxSec: cfg.maxSec,
        silenceThresholdSec: cfg.silenceThresholdSec,
        aiStatus: session.aiStatus,
        status: session.status,
      },
    });
  };

  let busy = false;
  let forcedTickTimer: unknown = null;

  const sink: TurnOutputSink = {
    onAiReply: (id, text) => send({ type: "ai.reply", data: { utteranceId: id, text } }),
    onAiSpeechStart: (id) => {
      session.aiStatus = "speaking";
      send({ type: "ai.speech.start", data: { utteranceId: id, sampleRate: 24000, format: "pcm16" } });
    },
    onAiSpeechChunk: (_id, chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    },
    onAiSpeechEnd: (id) => {
      session.aiStatus = "idle";
      send({ type: "ai.speech.end", data: { utteranceId: id } });
      eventRouter.handleAiFinishedSpeaking();
    },
  };

  const turnRunner = new TurnRunner({ llm: deps.agents.llm, tts: deps.agents.tts, sink });
  const speechBuffer = new SpeechBuffer(deps.agents.stt);

  async function ensureHiddenTestsRunIfNeeded(): Promise<void> {
    const hiddenCases = session.problem.test_cases.filter((t) => !t.is_sample);
    if (hiddenCases.length === 0 || session.hiddenTestsTotal > 0) return;
    const results = await runTestSuite(deps.agents.codeExecutor, session.language, session.latestCode, hiddenCases, new AbortController().signal);
    session.updateHiddenTestProgress(results.filter((t) => t.passed).length, hiddenCases.length);
  }

  function applyStageTransition(event: StageMachineEvent): void {
    const result = session.attemptTransition(event);
    if (!result.transitioned) return;
    void deps.interviewRepository.updateMeta(session.sessionId, {
      current_stage: session.currentStage,
      status: session.status,
    });
    if (session.status === "completed") {
      void finishSession();
    } else {
      sendState();
      eventRouter.onStageEntered();
    }
  }

  async function finishSession(): Promise<void> {
    await ensureHiddenTestsRunIfNeeded();
    const notes = session.turns.filter((t) => t.note).map((t) => t.note as string);
    const evaluation = await buildEvaluation(deps.agents.llm, {
      problem: session.problem,
      revealedConstraints: [...session.revealedConstraints],
      coveredTopics: [...session.coveredTopics],
      hintsGiven: session.hintsGiven,
      codeRunsCount: session.codeRuns.length,
      interruptions: session.interruptions,
      stageDurationsSec: session.stageDurationsSec,
      forcedTransitions: session.forcedTransitions,
      hiddenTestsPassed: session.hiddenTestsPassed,
      hiddenTestsTotal: session.hiddenTestsTotal,
      recentTurns: session.recentTurns,
      allNotes: notes,
      latestCode: session.latestCode,
    });
    await deps.interviewRepository.putEvaluation(session.sessionId, evaluation);
    await deps.interviewRepository.updateMeta(session.sessionId, { status: "completed", ended_at: new Date().toISOString() });
    send({ type: "session.evaluation", data: evaluation });
    sendState();
    cleanup();
  }

  async function runTurn(trigger: TriggerType, payload: TriggerPayload): Promise<void> {
    busy = true;
    session.aiStatus = "thinking";
    const controller = new AbortController();
    session.currentTurnController = controller;
    const startedAt = deps.clock.now();
    try {
      const result = await turnRunner.run({ session: session.toSnapshot(), trigger, payload, signal: controller.signal });
      if (controller.signal.aborted) return;
      session.recordTurn(result.turn);
      session.applyLlmReveal({ revealed_constraints: result.revealedConstraints, covered_topics: result.coveredTopics });
      deps.metrics.recordTurnLatency({
        llmMs: result.turn.latencyMs?.llm,
        ttsFirstAudioMs: result.turn.latencyMs?.ttsFirstAudio,
        ttsTotalMs: result.turn.latencyMs?.ttsTotal,
        totalMs: deps.clock.now() - startedAt,
      });
      deps.metrics.recordJsonOutcome(!result.turn.error);
      if (result.turn.error) deps.metrics.recordError("llm");
      void deps.interviewRepository.putTurn(session.sessionId, result.turn).catch(() => deps.metrics.recordError("persistence"));
      if (result.stageAction === "next_stage" || result.stageAction === "end") {
        applyStageTransition({ type: "llm_next_stage" });
      }
    } finally {
      if (session.aiStatus === "thinking") session.aiStatus = "idle";
      session.currentTurnController = null;
      busy = false;
      const pending = eventRouter.flushPending();
      if (pending.length > 0) {
        const merged = pending[pending.length - 1];
        void runTurn(merged.kind as TriggerType, merged);
      }
    }
  }

  const eventRouter = new EventRouter({
    clock: deps.clock,
    getSilenceThresholdSec: () => getStageConfig(session.currentStage).silenceThresholdSec,
    getStageElapsedSec: () => session.stageElapsedSec,
    getStageMaxSec: () => getStageConfig(session.currentStage).maxSec,
    isBusy: () => busy,
    onTrigger: (trigger, payload) => void runTurn(trigger, payload),
    onInterrupt: () => {
      session.currentTurnController?.abort();
      const lastTurn = session.turns.at(-1);
      if (lastTurn) session.markInterrupted(lastTurn.turnId);
      send({ type: "ai.speech.cancelled", data: { utteranceId: lastTurn?.turnId ?? "" } });
      session.aiStatus = "listening";
    },
    onStagePrecondition: (message) => send({ type: "error", data: { code: "STAGE_PRECONDITION", message, retryable: false } }),
    canDoneStage: () => {
      const result = session.attemptTransition({ type: "stage_done_button" });
      if (result.rejected) return { ok: false, message: result.rejected.message };
      if (result.transitioned) {
        void deps.interviewRepository.updateMeta(session.sessionId, {
          current_stage: session.currentStage,
          status: session.status,
        });
        if (session.status === "completed") void finishSession();
        else {
          sendState();
          eventRouter.onStageEntered();
        }
      }
      return { ok: true };
    },
  });

  function scheduleForcedTick(): void {
    forcedTickTimer = deps.clock.setTimeout(() => {
      applyStageTransition({ type: "tick" });
      scheduleForcedTick();
    }, 5000);
  }

  function cleanup(): void {
    deps.clock.clearTimeout(forcedTickTimer);
    eventRouter.dispose();
    if (connections.get(sessionId) && connections.get(sessionId)?.ws === ws) connections.delete(sessionId);
  }

  connections.set(sessionId, { ws, eventRouter, forcedTickTimer, clock: deps.clock });

  sendState();
  eventRouter.onStageEntered();
  scheduleForcedTick();

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      speechBuffer.addChunk(data);
      return;
    }
    const text = data.toString("utf8");
    if (text.length > 1_000_000) {
      send({ type: "error", data: { code: "PAYLOAD_TOO_LARGE", message: "Message too large", retryable: false } });
      return;
    }
    const decoded = decodeClientMessage(text);
    if (!decoded.ok) {
      send({ type: "error", data: { code: "INVALID_MESSAGE", message: decoded.error, retryable: false } });
      return;
    }
    void handleClientMessage(decoded.value);
  });

  ws.on("close", () => {
    if (connections.get(sessionId)?.ws === ws) cleanup();
  });

  async function handleClientMessage(msg: Awaited<ReturnType<typeof decodeClientMessage>> extends { ok: true; value: infer V } ? V : never): Promise<void> {
    switch (msg.type) {
      case "speech.start":
        session.aiStatus = "listening";
        eventRouter.handleSpeechStart();
        return;
      case "speech.pause":
        await speechBuffer.pause(new AbortController().signal);
        return;
      case "speech.end": {
        const { transcript, sttMs } = await speechBuffer.end(new AbortController().signal);
        if (transcript) send({ type: "transcript.user", data: { utteranceId: randomUUID(), text: transcript } });
        deps.metrics.recordTurnLatency({ sttMs });
        eventRouter.handleSpeechEnd(transcript);
        return;
      }
      case "editor.update":
        session.latestCode = msg.data.code;
        eventRouter.handleEditorUpdate();
        return;
      case "code.run": {
        const customInput = msg.data?.customInput;
        const runId = randomUUID();
        let result: CodeRunResult;
        if (customInput !== undefined) {
          const single = await deps.agents.codeExecutor.run({
            language: session.language, code: session.latestCode, stdin: customInput, signal: new AbortController().signal,
          });
          result = { runId, mode: "custom", status: single.status, output: { stdout: single.stdout, stderr: single.stderr, timeMs: single.timeMs } };
        } else {
          const sampleCases = session.problem.test_cases.filter((t) => t.is_sample);
          const tests = await runTestSuite(deps.agents.codeExecutor, session.language, session.latestCode, sampleCases, new AbortController().signal);
          result = { runId, mode: "sample", status: "OK", tests };
        }
        session.recordCodeRun(result);
        send({ type: "code.result", data: result });
        void deps.interviewRepository.putCodeSnapshot(session.sessionId, session.currentStage, session.latestCode, session.language);
        void deps.interviewRepository.putRun(session.sessionId, session.currentStage, result);

        if (session.currentStage === 4) {
          const hiddenCases = session.problem.test_cases.filter((t) => !t.is_sample);
          if (hiddenCases.length > 0) {
            const hiddenResults = await runTestSuite(deps.agents.codeExecutor, session.language, session.latestCode, hiddenCases, new AbortController().signal);
            const passed = hiddenResults.filter((t) => t.passed).length;
            session.updateHiddenTestProgress(passed, hiddenCases.length);
            if (passed === hiddenCases.length) applyStageTransition({ type: "hidden_tests_passed" });
          }
        }
        eventRouter.handleCodeRunResult(result);
        return;
      }
      case "whiteboard.update":
        session.latestBoardByStage[session.currentStage] = msg.data;
        eventRouter.handleWhiteboardUpdate();
        return;
      case "whiteboard.done": {
        const board = session.latestBoardByStage[session.currentStage];
        if (board) void deps.interviewRepository.putBoard(session.sessionId, session.currentStage, board);
        eventRouter.handleWhiteboardDone();
        return;
      }
      case "stage.done":
        eventRouter.handleStageDone();
        return;
      case "session.end":
        applyStageTransition({ type: "stage_done_button" });
        return;
    }
  }
}
```

> **Giới hạn đã biết (ghi lại để minh bạch, không phải lỗi):** test ẩn chỉ được chạy lại khi có `code.run` ở chặng 4, hoặc — nếu buổi kết thúc mà chưa từng chạy — đúng 1 lần khi tạo bản nhận xét cuối (`ensureHiddenTestsRunIfNeeded`). Trường hợp ứng viên bị bắt buộc rời chặng 4 (`tick` hết giờ) mà chưa `code.run` lần nào ở chặng 4 vẫn được `finishSession` bù lại nên số liệu `hidden_tests_passed/total` trong bản nhận xét luôn phản ánh code cuối cùng.

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npm test -- ws-gateway`
Expected: PASS (6 test)

- [ ] **Step 5: Commit**

```bash
git add src/interview/ws/ws-gateway.ts src/interview/ws/ws-gateway.test.ts
git commit -m "feat(interview): add WsGateway wiring session, router, turn runner and persistence

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 17: REST API — tạo phiên + xem báo cáo

**Files:**
- Modify: `vitest.config.ts` (thêm alias `@` để route dùng được `@/interview/...` như quy ước Next.js sẵn có trong `tsconfig.json`)
- Create: `src/app/api/interview/sessions/route.ts`
- Create: `src/app/api/interview/sessions/route.test.ts`
- Create: `src/app/api/interview/sessions/[id]/route.ts`
- Create: `src/app/api/interview/sessions/[id]/route.test.ts`

**Interfaces:**
- Consumes: `getInterviewRuntime`/`setInterviewRuntimeForTest`/`resetInterviewRuntimeForTest` (Task 15), `hashToken` (Task 16), `TooManySessionsError` (Task 5), `ProblemNotFoundError` (Task 13), `STAGE_CONFIG` (Task 3).
- Produces: `POST /api/interview/sessions`, `GET /api/interview/sessions/:id` — dùng ở Task 18 (server.ts chỉ cần Next tự route, không cần wiring thêm), Task 19 (trang test gọi 2 API này), Task 20 (script mô phỏng gọi API tạo phiên).

> **Đơn giản hóa có chủ đích:** `metrics` trong response của `GET .../:id` là số liệu **gộp toàn bộ các phiên** (từ `MetricsCollector` singleton trong `runtime.ts`), không tách riêng theo từng phiên — đúng mục tiêu "đo hiệu quả chung của model gốc" ở mục 1.1 của spec, không phải theo dõi hiệu năng một buổi cụ thể.

- [ ] **Step 1: Thêm alias `@` vào `vitest.config.ts`**

Old:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

New:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Viết test cho `POST /api/interview/sessions`**

```ts
// src/app/api/interview/sessions/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { POST } from "./route";
import { setInterviewRuntimeForTest, resetInterviewRuntimeForTest, type InterviewRuntime } from "@/interview/runtime";
import { SessionManager } from "@/interview/session/session-manager";
import { SystemClock } from "@/interview/session/clock";
import { MetricsCollector } from "@/interview/metrics/metrics";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeModelHealth, FakeCodeExecutor } from "@/interview/agents/fakes";
import { ProblemNotFoundError } from "@/interview/persistence/problem-repository";
import type { Problem } from "@/interview/domain/types";
import type { ProblemRepository } from "@/interview/persistence/problem-repository";
import type { InterviewRepository } from "@/interview/persistence/interview-repository";

const PROBLEM: Problem = {
  problem_id: "prob_1", title: "Two Sum", description: "d", difficulty: "EASY", category: "Array",
  starter_code: "def f(): pass",
  test_cases: [
    { id: 1, input: "a", output: "b", is_sample: true },
    { id: 2, input: "c", output: "d", is_sample: false },
  ],
  hidden_constraints: ["bí mật"],
};

function fakeProblemRepo(problem: Problem | null = PROBLEM): ProblemRepository {
  return {
    getProblem: async (id: string) => {
      if (!problem || id !== problem.problem_id) throw new ProblemNotFoundError(id);
      return problem;
    },
    getRandomProblemId: async () => problem?.problem_id ?? "prob_1",
  } as unknown as ProblemRepository;
}

function fakeInterviewRepo(): InterviewRepository {
  return { createMeta: async () => {}, updateMeta: async () => {} } as unknown as InterviewRepository;
}

function buildRuntime(overrides: Partial<InterviewRuntime> = {}): InterviewRuntime {
  return {
    sessionManager: new SessionManager({ maxConcurrent: 2 }),
    problemRepository: fakeProblemRepo(),
    interviewRepository: fakeInterviewRepo(),
    metrics: new MetricsCollector(),
    clock: new SystemClock(),
    agents: {
      llm: new FakeLlmAgent(), stt: new FakeSttAgent(), tts: new FakeTtsAgent(),
      codeExecutor: new FakeCodeExecutor(() => ({ status: "OK", stdout: "", stderr: "", timeMs: 0 })),
      modelHealth: new FakeModelHealth(),
    },
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/interview/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/interview/sessions", () => {
  afterEach(() => resetInterviewRuntimeForTest());

  it("tạo phiên thành công, không lộ hidden_constraints hay test ẩn", async () => {
    setInterviewRuntimeForTest(buildRuntime());
    const res = await POST(jsonRequest({ problemId: "prob_1", language: "python" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^ses_/);
    expect(body.token).toBeTruthy();
    expect(body.problem.sampleTests).toEqual([{ id: 1, input: "a", output: "b" }]);
    expect(body.problem).not.toHaveProperty("hidden_constraints");
    expect(JSON.stringify(body)).not.toContain("bí mật");
    expect(body.stages.length).toBe(6);
  });

  it("trả 503 MODELS_NOT_READY khi model chưa sẵn sàng", async () => {
    const runtime = buildRuntime();
    runtime.agents.modelHealth = new FakeModelHealth({ qwen: false, stt: true, tts: true });
    setInterviewRuntimeForTest(runtime);
    const res = await POST(jsonRequest({ language: "python" }));
    expect(res.status).toBe(503);
  });

  it("trả 404 khi problemId không tồn tại", async () => {
    setInterviewRuntimeForTest(buildRuntime({ problemRepository: fakeProblemRepo(null) }));
    const res = await POST(jsonRequest({ problemId: "khong_ton_tai", language: "python" }));
    expect(res.status).toBe(404);
  });

  it("trả 429 khi vượt số phiên đồng thời tối đa", async () => {
    setInterviewRuntimeForTest(buildRuntime({ sessionManager: new SessionManager({ maxConcurrent: 0 }) }));
    const res = await POST(jsonRequest({ problemId: "prob_1", language: "python" }));
    expect(res.status).toBe(429);
  });

  it("trả 400 khi thiếu language", async () => {
    setInterviewRuntimeForTest(buildRuntime());
    const res = await POST(jsonRequest({ problemId: "prob_1" }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận fail**

Run: `npm test -- app/api/interview/sessions/route.test`
Expected: FAIL — module `./route` không tồn tại

- [ ] **Step 4: Viết `src/app/api/interview/sessions/route.ts`**

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getInterviewRuntime } from "@/interview/runtime";
import { hashToken } from "@/interview/ws/ws-gateway";
import { TooManySessionsError } from "@/interview/session/session-manager";
import { ProblemNotFoundError } from "@/interview/persistence/problem-repository";
import { STAGE_CONFIG } from "@/interview/config/stages";

const CreateSessionRequestSchema = z.object({
  problemId: z.string().optional(),
  language: z.enum(["python", "javascript", "cpp"]),
  userId: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "INVALID_BODY", message: "Body phải là JSON hợp lệ" }, { status: 400 });
  }
  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_BODY", message: parsed.error.message }, { status: 400 });
  }

  const runtime = getInterviewRuntime();
  const health = await runtime.agents.modelHealth.check();
  if (!health.qwen || !health.stt || !health.tts) {
    return Response.json({ code: "MODELS_NOT_READY", details: health }, { status: 503 });
  }

  const problemId = parsed.data.problemId ?? (await runtime.problemRepository.getRandomProblemId());
  let problem;
  try {
    problem = await runtime.problemRepository.getProblem(problemId);
  } catch (err) {
    if (err instanceof ProblemNotFoundError) {
      return Response.json({ code: "PROBLEM_NOT_FOUND", message: err.message }, { status: 404 });
    }
    throw err;
  }

  const sessionId = `ses_${randomUUID()}`;
  const token = randomBytes(24).toString("hex");

  let session;
  try {
    session = runtime.sessionManager.create({
      sessionId,
      tokenHash: hashToken(token),
      problem,
      language: parsed.data.language,
      userId: parsed.data.userId,
      clock: runtime.clock,
    });
  } catch (err) {
    if (err instanceof TooManySessionsError) {
      return Response.json({ code: "TOO_MANY_SESSIONS", message: "Đang có quá nhiều phiên chạy đồng thời" }, { status: 429 });
    }
    throw err;
  }

  await runtime.interviewRepository.createMeta({
    session_id: sessionId,
    sk: "META",
    problem_id: problem.problem_id,
    language: session.language,
    user_id: parsed.data.userId,
    token_hash: session.tokenHash,
    status: "active",
    current_stage: 1,
    started_at: new Date().toISOString(),
    model_versions: { qwen: "fake", stt: "fake", tts: "fake" },
  });

  return Response.json(
    {
      sessionId,
      token,
      problem: {
        problemId: problem.problem_id,
        title: problem.title,
        description: problem.description,
        starterCode: problem.starter_code,
        sampleTests: problem.test_cases
          .filter((t) => t.is_sample)
          .map((t) => ({ id: t.id, input: t.input, output: t.output })),
      },
      stages: STAGE_CONFIG.map((s) => ({ index: s.index, name: s.name, minSec: s.minSec, maxSec: s.maxSec })),
    },
    { status: 201 },
  );
}
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `npm test -- app/api/interview/sessions/route.test`
Expected: PASS (5 test)

- [ ] **Step 6: Viết test cho `GET /api/interview/sessions/:id`**

```ts
// src/app/api/interview/sessions/[id]/route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { GET } from "./route";
import { setInterviewRuntimeForTest, resetInterviewRuntimeForTest, type InterviewRuntime } from "@/interview/runtime";
import { hashToken } from "@/interview/ws/ws-gateway";
import { SessionManager } from "@/interview/session/session-manager";
import { SystemClock } from "@/interview/session/clock";
import { MetricsCollector } from "@/interview/metrics/metrics";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeModelHealth, FakeCodeExecutor } from "@/interview/agents/fakes";
import type { InterviewRepository, SessionReport } from "@/interview/persistence/interview-repository";
import type { ProblemRepository } from "@/interview/persistence/problem-repository";
import type { Problem } from "@/interview/domain/types";

const PROBLEM: Problem = { problem_id: "prob_1", title: "t", description: "d", difficulty: "EASY", category: "Array", starter_code: "", test_cases: [] };

function emptyReport(): SessionReport {
  return { meta: null, turns: [], codeRuns: [], boards: [], evaluation: null };
}

function fakeInterviewRepo(report: SessionReport): InterviewRepository {
  return { getSessionReport: async () => report } as unknown as InterviewRepository;
}

function buildRuntime(overrides: Partial<InterviewRuntime> = {}): InterviewRuntime {
  return {
    sessionManager: new SessionManager({ maxConcurrent: 2 }),
    problemRepository: {} as unknown as ProblemRepository,
    interviewRepository: fakeInterviewRepo(emptyReport()),
    metrics: new MetricsCollector(),
    clock: new SystemClock(),
    agents: {
      llm: new FakeLlmAgent(), stt: new FakeSttAgent(), tts: new FakeTtsAgent(),
      codeExecutor: new FakeCodeExecutor(() => ({ status: "OK", stdout: "", stderr: "", timeMs: 0 })),
      modelHealth: new FakeModelHealth(),
    },
    ...overrides,
  };
}

function getRequest(token?: string): Request {
  return new Request("http://localhost/api/interview/sessions/ses_1", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/interview/sessions/:id", () => {
  afterEach(() => resetInterviewRuntimeForTest());

  it("trả 401 khi thiếu Authorization header", async () => {
    setInterviewRuntimeForTest(buildRuntime());
    const res = await GET(getRequest(), { params: Promise.resolve({ id: "ses_1" }) });
    expect(res.status).toBe(401);
  });

  it("trả 404 khi phiên không tồn tại (không có trong bộ nhớ lẫn không có META)", async () => {
    setInterviewRuntimeForTest(buildRuntime());
    const res = await GET(getRequest("bat-ky-token"), { params: Promise.resolve({ id: "ses_khong_ton_tai" }) });
    expect(res.status).toBe(404);
  });

  it("trả 401 khi token sai với phiên đang mở trong bộ nhớ", async () => {
    const sessionManager = new SessionManager({ maxConcurrent: 2 });
    sessionManager.create({ sessionId: "ses_1", tokenHash: hashToken("dung"), problem: PROBLEM, language: "python", clock: new SystemClock() });
    setInterviewRuntimeForTest(buildRuntime({ sessionManager }));
    const res = await GET(getRequest("sai"), { params: Promise.resolve({ id: "ses_1" }) });
    expect(res.status).toBe(401);
  });

  it("trả 200 kèm turns/evaluation/metrics khi token đúng", async () => {
    const sessionManager = new SessionManager({ maxConcurrent: 2 });
    sessionManager.create({ sessionId: "ses_1", tokenHash: hashToken("dung"), problem: PROBLEM, language: "python", clock: new SystemClock() });
    const report: SessionReport = {
      meta: null,
      boards: [],
      codeRuns: [],
      turns: [{ turnId: "t1", role: "ai", stage: 1, trigger: "stage_enter", text: "chào", interrupted: false, createdAt: new Date().toISOString() }],
      evaluation: null,
    };
    setInterviewRuntimeForTest(buildRuntime({ sessionManager, interviewRepository: fakeInterviewRepo(report) }));
    const res = await GET(getRequest("dung"), { params: Promise.resolve({ id: "ses_1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.turns[0].text).toBe("chào");
    expect(body.metrics).toBeDefined();
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận fail**

Run: `npm test -- 'app/api/interview/sessions/\[id\]/route.test'`
Expected: FAIL — module `./route` không tồn tại

- [ ] **Step 8: Viết `src/app/api/interview/sessions/[id]/route.ts`**

```ts
import { getInterviewRuntime } from "@/interview/runtime";
import { hashToken } from "@/interview/ws/ws-gateway";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const runtime = getInterviewRuntime();

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) {
    return Response.json({ code: "UNAUTHORIZED", message: "Thiếu Authorization: Bearer <token>" }, { status: 401 });
  }

  const report = await runtime.interviewRepository.getSessionReport(id);
  const liveSession = runtime.sessionManager.get(id);
  const expectedHash = liveSession?.tokenHash ?? report.meta?.token_hash;
  if (!expectedHash) {
    return Response.json({ code: "NOT_FOUND", message: "Không tìm thấy phiên" }, { status: 404 });
  }
  if (hashToken(token) !== expectedHash) {
    return Response.json({ code: "UNAUTHORIZED", message: "Token không đúng" }, { status: 401 });
  }

  return Response.json({
    meta: report.meta,
    turns: report.turns,
    runs: report.codeRuns,
    boards: report.boards,
    evaluation: report.evaluation,
    metrics: runtime.metrics.summary(),
  });
}
```

- [ ] **Step 9: Chạy toàn bộ test REST, xác nhận pass**

Run: `npm test -- app/api/interview`
Expected: PASS (9 test)

- [ ] **Step 10: Commit**

```bash
git add vitest.config.ts src/app/api/interview/
git commit -m "feat(interview): add REST API to create sessions and read reports

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 18: Custom server (Next.js REST + WS upgrade trên cùng port)

**Files:**
- Create: `server.ts`

**Interfaces:**
- Consumes: `getInterviewRuntime` (Task 15), `attachWsGateway` (Task 16).
- Produces: tiến trình server chạy `npm run dev` / `npm start` (đã trỏ tới file này từ Task 1) — phục vụ Task 19, 20.

> **Rủi ro đã biết:** `app.getUpgradeHandler()` là API nội bộ Next.js dùng cho HMR qua WebSocket khi dev. Nếu bản Next.js 16 đang dùng đổi API này, bước xác minh dưới đây sẽ phát hiện ngay (trang không load được hoặc lỗi khi start). Nếu vậy, phương án dự phòng là bỏ qua việc forward cho Next ở nhánh `else` (build production sẽ không cần HMR) và chỉ áp dụng nhánh đó khi `dev === false`.

- [ ] **Step 1: Viết `server.ts`**

```ts
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { getInterviewRuntime } from "./src/interview/runtime";
import { attachWsGateway } from "./src/interview/ws/ws-gateway";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/ws/session/")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const runtime = getInterviewRuntime();
        attachWsGateway(ws, url, {
          sessionManager: runtime.sessionManager,
          interviewRepository: runtime.interviewRepository,
          metrics: runtime.metrics,
          clock: runtime.clock,
          agents: {
            llm: runtime.agents.llm,
            stt: runtime.agents.stt,
            tts: runtime.agents.tts,
            codeExecutor: runtime.agents.codeExecutor,
          },
        });
      });
    } else if (dev) {
      app.getUpgradeHandler()(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> Server ready on http://localhost:${port} (WS tại /ws/session/:id)`);
  });
});
```

- [ ] **Step 2: Xác minh REST vẫn chạy qua server tùy chỉnh**

Run:
```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```
Expected: in ra `200` (trang mặc định của Next vẫn load được qua `server.ts`).

- [ ] **Step 3: Xác minh đường WS upgrade hoạt động (đóng đúng mã lỗi khi session không tồn tại)**

Run:
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws/session/khong-ton-tai?token=x');
ws.on('close', (code) => { console.log('closed with code', code); process.exit(0); });
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
"
```
Expected: in ra `closed with code 4401`. Nếu lỗi kết nối hoặc treo — kiểm tra lại giả định về `app.getUpgradeHandler()` ở ghi chú rủi ro phía trên.

- [ ] **Step 4: Dừng server dev đã chạy nền**

Run: `kill %1` (hoặc tìm đúng PID bằng `lsof -i :3000` rồi `kill`)

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(interview): add custom Next.js server with WebSocket upgrade routing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 19: Trang test tối giản `/interview-test`

**Files:**
- Create: `src/app/interview-test/page.tsx`

**Interfaces:**
- Consumes: `POST /api/interview/sessions` (Task 17), giao thức WS (Task 2).
- Produces: trang web tự tạo phiên và cho phép test bằng giọng thật + code + whiteboard.

> **Lưu ý quan trọng khi test bằng tay:** plan này dùng `FakeTtsAgent`, trả về byte không phải PCM thật (`FAKE_AUDIO:<text>` dạng text encode thành buffer). Trình duyệt vẫn phát ra được "âm thanh" (thực chất là nhiễu), mục đích ở đây là **kiểm tra đường đi dữ liệu** (audio chunk có tới trình duyệt đúng lúc không), **không phải kiểm tra chất lượng giọng nói** — việc đó thuộc plan tích hợp viXTTS thật.

- [ ] **Step 1: Viết `src/app/interview-test/page.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

interface ProblemView {
  problemId: string;
  title: string;
  description: string;
  starterCode: string;
  sampleTests: Array<{ id: number; input: string; output: string }>;
}

export default function InterviewTestPage() {
  const [problem, setProblem] = useState<ProblemView | null>(null);
  const [code, setCode] = useState("");
  const [board, setBoard] = useState('{"nodes":[],"edges":[]}');
  const [log, setLog] = useState<string[]>([]);
  const [stageInfo, setStageInfo] = useState<string>("");
  const [evaluation, setEvaluation] = useState<unknown>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  function appendLog(line: string): void {
    setLog((prev) => [...prev, line]);
  }

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }

  function playAudioChunk(buf: ArrayBuffer): void {
    const ctx = getAudioCtx();
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const audioBuffer = ctx.createBuffer(1, float32.length || 1, 24000);
    if (float32.length > 0) audioBuffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const startAt = Math.max(playTimeRef.current, ctx.currentTime);
    source.start(startAt);
    playTimeRef.current = startAt + audioBuffer.duration;
  }

  function handleServerMessage(msg: { type: string; data: any }): void {
    switch (msg.type) {
      case "session.state":
        setStageInfo(
          `Chặng ${msg.data.stage}: ${msg.data.stageName} (${msg.data.stageElapsedSec}s/${msg.data.stageMaxSec}s) — AI: ${msg.data.aiStatus}`,
        );
        return;
      case "transcript.user":
        appendLog(`Bạn: ${msg.data.text}`);
        return;
      case "ai.reply":
        appendLog(`AI: ${msg.data.text}`);
        return;
      case "ai.speech.start":
        playTimeRef.current = getAudioCtx().currentTime;
        return;
      case "code.result":
        appendLog(`Kết quả chạy: ${JSON.stringify(msg.data)}`);
        return;
      case "session.evaluation":
        setEvaluation(msg.data);
        return;
      case "error":
        appendLog(`Lỗi: ${msg.data.code} — ${msg.data.message}`);
        return;
      default:
        return;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/interview/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "python" }),
      });
      const data = await res.json();
      if (cancelled) return;
      setProblem(data.problem);
      setCode(data.problem.starterCode);

      const ws = new WebSocket(`ws://${window.location.host}/ws/session/${data.sessionId}?token=${data.token}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (event) => {
        if (typeof event.data === "string") handleServerMessage(JSON.parse(event.data));
        else playAudioChunk(event.data as ArrayBuffer);
      };
    })();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording(): Promise<void> {
    wsRef.current?.send(JSON.stringify({ type: "speech.start" }));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    streamRef.current = stream;
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      wsRef.current?.send(int16.buffer);
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    processorRef.current = processor;
  }

  function stopRecording(): void {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current?.send(JSON.stringify({ type: "speech.end" }));
  }

  function sendCode(nextCode: string): void {
    setCode(nextCode);
    wsRef.current?.send(JSON.stringify({ type: "editor.update", data: { code: nextCode, language: "python" } }));
  }

  function runCode(): void {
    wsRef.current?.send(JSON.stringify({ type: "code.run" }));
  }

  function sendBoard(): void {
    try {
      const data = JSON.parse(board);
      wsRef.current?.send(JSON.stringify({ type: "whiteboard.update", data }));
      wsRef.current?.send(JSON.stringify({ type: "whiteboard.done" }));
    } catch {
      appendLog("Sơ đồ không phải JSON hợp lệ");
    }
  }

  function doneStage(): void {
    wsRef.current?.send(JSON.stringify({ type: "stage.done" }));
  }

  function endSession(): void {
    wsRef.current?.send(JSON.stringify({ type: "session.end" }));
  }

  if (!problem) return <p style={{ padding: 16 }}>Đang tạo phiên phỏng vấn...</p>;

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1>{problem.title}</h1>
      <p style={{ whiteSpace: "pre-wrap" }}>{problem.description}</p>
      <p>
        <strong>{stageInfo}</strong>
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onMouseDown={startRecording} onMouseUp={stopRecording}>🎤 Giữ để nói</button>
        <button onClick={runCode}>Chạy thử</button>
        <button onClick={doneStage}>Em xong phần này</button>
        <button onClick={endSession}>Kết thúc</button>
      </div>

      <h3>Code</h3>
      <textarea value={code} onChange={(e) => sendCode(e.target.value)} rows={12} style={{ width: "100%", fontFamily: "monospace" }} />

      <h3>Whiteboard (JSON dạng {"{"}"nodes":[...],"edges":[...]{"}"})</h3>
      <textarea value={board} onChange={(e) => setBoard(e.target.value)} rows={4} style={{ width: "100%", fontFamily: "monospace" }} />
      <button onClick={sendBoard}>Xong sơ đồ</button>

      <h3>Transcript</h3>
      <div style={{ background: "#f5f5f5", padding: 8, minHeight: 120, whiteSpace: "pre-wrap" }}>{log.join("\n")}</div>

      {evaluation ? (
        <>
          <h3>Nhận xét cuối buổi</h3>
          <pre>{JSON.stringify(evaluation, null, 2)}</pre>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Xác minh thủ công bằng trình duyệt (Chrome khuyến nghị)**

Run: `npm run dev`, mở `http://localhost:3000/interview-test`, cho phép quyền micro.
Expected:
- Thấy tiêu đề đề bài và dòng trạng thái "Chặng 1: Làm rõ yêu cầu...".
- Giữ nút "🎤 Giữ để nói", nói vài giây, thả ra → mục Transcript xuất hiện dòng "Bạn: ..." rồi "AI: ...".
- Bấm "Chạy thử" → Transcript hiện dòng "Kết quả chạy: ...".
- Sửa ô Whiteboard thành `{"nodes":[{"id":"n1","label":"a","x":0,"y":0}],"edges":[]}` rồi bấm "Xong sơ đồ" → không có lỗi hiện ra.

- [ ] **Step 3: Commit**

```bash
git add src/app/interview-test/page.tsx
git commit -m "feat(interview): add minimal manual test page for voice/code/whiteboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

### Task 20: Script mô phỏng cả buổi phỏng vấn + hoàn thiện README

> **Giới hạn đã biết:** `FakeSttAgent` dùng chung cho cả server (một hàng đợi rỗng, luôn trả `""`), nên script chạy từ tiến trình ngoài **không** thể kịch bản hóa nội dung transcript cho từng câu nói — việc đó Task 9/16 đã kiểm bằng unit/integration test có inject trực tiếp `FakeSttAgent` rồi. Script này tập trung xác nhận: đi hết 6 chặng, `code.run` chạy qua Judge0 thật, đường audio nhị phân không làm crash server, và bản nhận xét cuối buổi được tạo ra — tức là toàn bộ hạ tầng thật (server, DynamoDB, Judge0) hoạt động đúng với nhau từ đầu đến cuối.

**Files:**
- Create: `scripts/simulate-interview.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `POST /api/interview/sessions`, `GET /api/interview/sessions/:id` (Task 17), giao thức WS (Task 2).
- Produces: lệnh `npm run simulate` (đã khai báo ở Task 1) chạy được với server thật.

- [ ] **Step 1: Viết `scripts/simulate-interview.ts`**

```ts
import WebSocket from "ws";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const WS_BASE = BASE_URL.replace(/^http/, "ws");

interface ServerMsg { type: string; data?: any; }

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

async function createSession(): Promise<{ sessionId: string; token: string; problem: any }> {
  const res = await fetch(`${BASE_URL}/api/interview/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "python" }),
  });
  if (!res.ok) throw new Error(`Tạo phiên thất bại: ${res.status} ${await res.text()}`);
  return res.json();
}

function waitForMessage(ws: WebSocket, predicate: (msg: ServerMsg) => boolean, timeoutMs = 15000): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Hết thời gian chờ message")), timeoutMs);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { sessionId, token, problem } = await createSession();
  log("Đã tạo phiên", sessionId, "— đề:", problem.title);

  const ws = new WebSocket(`${WS_BASE}/ws/session/${sessionId}?token=${token}`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  log("Đã kết nối WebSocket");

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const msg = JSON.parse(data.toString()) as ServerMsg;
    if (msg.type === "session.state") {
      log(`[state] chặng ${msg.data.stage} (${msg.data.stageName}) — AI: ${msg.data.aiStatus}`);
    } else if (msg.type === "ai.reply") {
      log(`[AI nói] ${msg.data.text}`);
    } else if (msg.type === "error") {
      log(`[LỖI] ${msg.data.code}: ${msg.data.message}`);
    }
  });

  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 1);

  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 2);
  log("Đã qua chặng 2");

  ws.send(JSON.stringify({ type: "whiteboard.update", data: { nodes: [{ id: "n1", label: "hash map", x: 0, y: 0 }], edges: [] } }));
  ws.send(JSON.stringify({ type: "whiteboard.done" }));
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 3);
  log("Đã qua chặng 3");

  ws.send(JSON.stringify({ type: "editor.update", data: { code: problem.starterCode, language: "python" } }));
  ws.send(JSON.stringify({ type: "code.run" }));
  await waitForMessage(ws, (m) => m.type === "code.result");
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 4);
  log("Đã qua chặng 4");

  ws.send(JSON.stringify({ type: "code.run" }));
  await waitForMessage(ws, (m) => m.type === "code.result");
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 5);
  log("Đã qua chặng 5");

  ws.send(JSON.stringify({ type: "whiteboard.update", data: { nodes: [{ id: "n1", label: "shard theo hash", x: 0, y: 0 }], edges: [] } }));
  ws.send(JSON.stringify({ type: "whiteboard.done" }));
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 6);
  log("Đã qua chặng 6");

  // Gửi 1 đoạn audio rỗng để xác nhận đường audio nhị phân không làm crash server.
  ws.send(JSON.stringify({ type: "speech.start" }));
  ws.send(new Int16Array(1600).buffer);
  ws.send(JSON.stringify({ type: "speech.end" }));
  await new Promise((r) => setTimeout(r, 500));

  ws.send(JSON.stringify({ type: "session.end" }));
  const evalMsg = await waitForMessage(ws, (m) => m.type === "session.evaluation");
  log("Nhận được bản nhận xét cuối buổi:");
  console.log(JSON.stringify(evalMsg.data, null, 2));

  const reportRes = await fetch(`${BASE_URL}/api/interview/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const report = await reportRes.json();
  log("Số liệu độ trễ (metrics, gộp toàn server):", JSON.stringify(report.metrics));

  log(`Hoàn tất mô phỏng sau ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Chạy mô phỏng với server thật (cần `npm run dev` đang chạy ở terminal khác, cùng DynamoDB Local + Judge0 đã bật từ Task 12/14)**

Run:
```bash
npm run dev &
sleep 3
npm run simulate
kill %1
```
Expected: log lần lượt "Đã qua chặng 2" → "6", không có dòng `[LỖI]` nào, kết thúc bằng JSON bản nhận xét cuối buổi và dòng "Hoàn tất mô phỏng sau ...s".

- [ ] **Step 3: Cập nhật `README.md` — thêm hướng dẫn chạy module AI Interviewer**

Old:
```markdown
## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
```

New:
```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add scripts/simulate-interview.ts README.md
git commit -m "feat(interview): add end-to-end simulation script and setup docs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MUFTtbSpXFjJd3tNut85NN"
```

---

## Sau khi hoàn thành cả 20 task

Kết quả: một module backend AI Interviewer chạy đầy đủ 6 chặng, qua WebSocket + REST, chấm code bằng Judge0 thật, lưu DynamoDB thật, có trang test bằng giọng thật và script mô phỏng tự động — toàn bộ dùng agent AI giả lập đứng sau interface cố định.

**Việc tiếp theo (plan riêng, chưa nằm trong phạm vi plan này):** viết `SageMakerQwenAgent`, `SageMakerWhisperAgent`, `SageMakerViXttsAgent`, `SageMakerModelHealth` implement đúng 4 interface đã có sẵn trong `src/interview/agents/types.ts`, cộng với `infra/sagemaker/` (script deploy/teardown/status) và test live (`npm run test:live`). Việc đó cần tài khoản AWS đã được duyệt quota GPU (`ml.g5.xlarge`, `ml.g4dn.xlarge` cho SageMaker endpoint).
