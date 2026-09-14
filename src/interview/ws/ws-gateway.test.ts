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
