import { SessionManager } from "./session/session-manager";
import { SystemClock, type Clock } from "./session/clock";
import { createDdbClient } from "./persistence/ddb-client";
import { ProblemRepository } from "./persistence/problem-repository";
import { InterviewRepository } from "./persistence/interview-repository";
import { MetricsCollector } from "./metrics/metrics";
import { Judge0Executor } from "./agents/judge0-executor";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent } from "./agents/fakes";
import { OllamaLlmAgent, checkOllamaHasModel } from "./agents/ollama-llm-agent";
import { WhisperSttAgent, checkWhisperHealth } from "./agents/whisper-stt-agent";
import { CompositeModelHealth } from "./agents/composite-model-health";
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

// Mặc định cả LLM và STT vẫn dùng bản giả lập (CI/test cần nhanh và tất định). Bật
// INTERVIEW_LLM_PROVIDER=ollama / INTERVIEW_STT_PROVIDER=whisper (độc lập nhau) để cắm model
// HuggingFace chạy local làm "bộ não"/"tai nghe" thật. Xem
// docs/superpowers/specs/2026-09-15-ai-interviewer-followup-ideas.md.
function buildLlmAgent(): { llm: LlmAgent; checkQwen: () => Promise<boolean> } {
  if (process.env.INTERVIEW_LLM_PROVIDER === "ollama") {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
    return { llm: new OllamaLlmAgent(baseUrl, model), checkQwen: () => checkOllamaHasModel(baseUrl, model) };
  }
  return { llm: new FakeLlmAgent(), checkQwen: async () => true };
}

function buildSttAgent(): { stt: SttAgent; checkStt: () => Promise<boolean> } {
  if (process.env.INTERVIEW_STT_PROVIDER === "whisper") {
    const baseUrl = process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8200";
    return { stt: new WhisperSttAgent(baseUrl), checkStt: () => checkWhisperHealth(baseUrl) };
  }
  return { stt: new FakeSttAgent(), checkStt: async () => true };
}

function buildRuntime(): InterviewRuntime {
  const ddb = createDdbClient();
  const { llm, checkQwen } = buildLlmAgent();
  const { stt, checkStt } = buildSttAgent();
  return {
    sessionManager: new SessionManager({ maxConcurrent: Number(process.env.MAX_CONCURRENT_SESSIONS ?? 2) }),
    problemRepository: new ProblemRepository(ddb),
    interviewRepository: new InterviewRepository(ddb),
    metrics: new MetricsCollector(),
    clock: new SystemClock(),
    // TTS vẫn dùng bản giả lập ở plan này — việc tiếp theo trong ghi chú follow-up.
    agents: {
      llm,
      stt,
      tts: new FakeTtsAgent(),
      codeExecutor: new Judge0Executor(process.env.JUDGE0_URL ?? "http://127.0.0.1:2358"),
      modelHealth: new CompositeModelHealth({ qwen: checkQwen, stt: checkStt, tts: async () => true }),
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
