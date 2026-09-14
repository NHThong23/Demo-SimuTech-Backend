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
