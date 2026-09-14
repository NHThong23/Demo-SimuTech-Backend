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

  it("createMeta lỗi (DynamoDB) không để lại slot đồng thời bị kẹt: session bị remove khỏi SessionManager và trả 500 (I12)", async () => {
    const sessionManager = new SessionManager({ maxConcurrent: 1 });
    const failingRepo: InterviewRepository = {
      createMeta: async () => {
        throw new Error("DynamoDB hiccup");
      },
      updateMeta: async () => {},
    } as unknown as InterviewRepository;
    setInterviewRuntimeForTest(buildRuntime({ sessionManager, interviewRepository: failingRepo }));

    const res = await POST(jsonRequest({ problemId: "prob_1", language: "python" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBeTruthy();

    // The slot must be free again — a session count at maxConcurrent (1) before this call means
    // a stranded "active" session would make the next request fail with 429.
    const res2 = await POST(jsonRequest({ problemId: "prob_1", language: "python" }));
    // Second call still uses the failing repo, so it also fails persistence — the point of this
    // assertion is specifically that it fails with 500 (slot was available to attempt), not 429
    // (slot permanently stranded).
    expect(res2.status).toBe(500);
  });
});
