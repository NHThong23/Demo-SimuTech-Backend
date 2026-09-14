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
