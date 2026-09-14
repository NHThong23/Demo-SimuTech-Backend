import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { attachWsGateway, hashToken, type WsGatewayDeps } from "./ws-gateway";
import { SessionManager } from "../session/session-manager";
import type { InterviewRepository } from "../persistence/interview-repository";
import { MetricsCollector } from "../metrics/metrics";
import { SystemClock, type Clock } from "../session/clock";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeCodeExecutor } from "../agents/fakes";
import type { ChatMessage, LlmAgent } from "../agents/types";
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

  function makeDeps(overrides: Partial<{ llm: LlmAgent; clock: Clock }> = {}): WsGatewayDeps {
    return {
      sessionManager,
      interviewRepository: noopRepo(),
      metrics: new MetricsCollector(),
      clock: overrides.clock ?? new SystemClock(),
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

  it("đóng kết nối với mã 4404 khi session_id không tồn tại", async () => {
    const deps = makeDeps();
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    // Cố ý KHÔNG gọi sessionManager.create(...) cho session_id này.
    const ws = new WebSocket(`ws://localhost:${port}/ws/session/khong-ton-tai?token=tok`);
    const closeCode = await new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    expect(closeCode).toBe(4404);
  });

  it("hủy đúng handle forced-tick timer hiện tại khi bị thay bởi kết nối mới (không rò rỉ timer cũ)", async () => {
    // Bug đã sửa: connections.set(...) từng lưu snapshot của biến forcedTickTimer TRƯỚC khi
    // scheduleForcedTick() chạy lần đầu, nên giá trị lưu trong map luôn là `null` — khiến
    // clearTimeout(existing.forcedTickTimer) ở lần reconnect kế tiếp trở thành no-op và timer
    // 5s lặp lại của kết nối cũ chạy mãi mãi. Test này bắt trực tiếp gốc rễ: bọc Clock để ghi
    // lại các lời gọi setTimeout xuất phát cụ thể từ scheduleForcedTick (nhận diện qua stack
    // trace, vì EventRouter cũng tự lên lịch các timer riêng của nó dùng cùng khoảng 5000ms nên
    // không thể phân biệt chỉ bằng số ms hay thứ tự/đếm số lần gọi — thứ tự đó còn phụ thuộc vào
    // việc lượt AI mở đầu đã nói xong kịp trước khi sự kiện "open" phía client bắn ra hay chưa),
    // rồi xác nhận lần reconnect thực sự clearTimeout đúng handle đó — không phải null/handle sai.
    const forcedTickSetTimeoutHandles: unknown[] = [];
    const clearTimeoutCalls: unknown[] = [];
    const real = new SystemClock();
    const spyClock: Clock = {
      now: () => real.now(),
      setTimeout: (fn, ms) => {
        const handle = real.setTimeout(fn, ms);
        if (new Error().stack?.includes("scheduleForcedTick")) forcedTickSetTimeoutHandles.push(handle);
        return handle;
      },
      clearTimeout: (handle) => {
        clearTimeoutCalls.push(handle);
        real.clearTimeout(handle);
      },
    };
    const deps = makeDeps({ clock: spyClock });
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    sessionManager.create({ sessionId: "s9", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });

    const ws1 = new WebSocket(`ws://localhost:${port}/ws/session/s9?token=tok`);
    await new Promise((resolve) => ws1.once("open", resolve));

    expect(forcedTickSetTimeoutHandles.length).toBeGreaterThanOrEqual(1);
    const ws1ForcedTickHandle = forcedTickSetTimeoutHandles[0];

    const ws2 = new WebSocket(`ws://localhost:${port}/ws/session/s9?token=tok`);
    await new Promise((resolve) => ws2.once("open", resolve));

    // The reconnect must cancel ws1's forced-tick timer using its real, current handle.
    expect(clearTimeoutCalls).toContain(ws1ForcedTickHandle);

    ws1.close();
    ws2.close();
  });

  it("ngắt lời sau khi đã có ít nhất 1 lượt trước đó: đánh dấu đúng turn interrupted và đúng utteranceId", async () => {
    const llm = new FakeLlmAgent();
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Chào bạn.", note: null, revealed_constraints: [], covered_topics: [] }));
    llm.enqueue(JSON.stringify({ action: "speak", reply: "Câu một. Câu hai. Câu ba.", note: null, revealed_constraints: [], covered_topics: [] }));
    const deps = makeDeps({ llm });
    const { wss, port } = await startServer(deps);
    servers.push(wss);
    const session = sessionManager.create({ sessionId: "s10", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock });

    const ws = new WebSocket(`ws://localhost:${port}/ws/session/s10?token=tok`);
    // Chờ lượt đầu tiên (stage_enter, "Chào bạn.") nói xong hoàn toàn và được ghi vào session.turns.
    await waitForType(ws, "ai.speech.end");

    // Kích hoạt lượt AI thứ hai qua code.run (không phụ thuộc FakeSttAgent).
    const secondStartPromise = waitForType(ws, "ai.speech.start");
    ws.send(JSON.stringify({ type: "code.run" }));
    const secondStart = await secondStartPromise;

    // Trước khi sửa: onInterrupt dùng session.turns.at(-1), tại thời điểm này session.turns chỉ
    // có lượt ĐẦU TIÊN (lượt thứ hai chưa kịp được recordTurn vì đó là việc runTurn làm SAU khi
    // turnRunner.run() resolve, tức là sau khi onInterrupt đã chạy xong) — nên sẽ đánh dấu nhầm
    // lượt đầu tiên và gửi sai utteranceId.
    const cancelledPromise = waitForType(ws, "ai.speech.cancelled");
    ws.send(JSON.stringify({ type: "speech.start" }));
    const cancelled = await cancelledPromise;

    expect(cancelled.data.utteranceId).toBe(secondStart.data.utteranceId);
    expect(cancelled.data.utteranceId).not.toBe("");

    // Đợi runTurn của lượt bị ngắt resolve và tự ghi nhận mình vào session.turns.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const interruptedTurn = session.turns.find((t) => t.turnId === secondStart.data.utteranceId);
    expect(interruptedTurn?.interrupted).toBe(true);
    expect(session.interruptions).toBeGreaterThanOrEqual(1);
    expect(session.turns[0]?.interrupted).toBe(false);

    ws.close();
  });

  it("ngắt lời khi LLM đang 'suy nghĩ' (chưa kịp trả lời) không gây unhandled rejection", async () => {
    // Fake LLM có thể điều khiển được: chat() KHÔNG BAO GIỜ tự resolve — nó chỉ reject khi
    // AbortSignal truyền vào bị abort (đúng như một client HTTP/gRPC thật sẽ làm khi request bị
    // hủy giữa chừng). Điều này tạo ra đúng cửa sổ thời gian mà FakeLlmAgent thường dùng (resolve
    // ngay lập tức) không bao giờ tạo ra được: interrupt đến trong lúc turnRunner.run() còn đang
    // chờ llm.chat(), TRƯỚC KHI TurnRunner kịp tạo ra Turn hay gọi onAiSpeechStart.
    class DeferredLlmAgent implements LlmAgent {
      async chat(_messages: ChatMessage[], opts: { signal: AbortSignal; maxTokens: number; json: boolean }): Promise<string> {
        return new Promise((_resolve, reject) => {
          const onAbort = () => reject(new Error("aborted mid-thinking"));
          if (opts.signal.aborted) {
            onAbort();
            return;
          }
          opts.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }

    // Bắt trực tiếp unhandled rejection: nếu bug còn tồn tại (runTurn không catch rejection của
    // turnRunner.run() khi bị abort giữa lúc "thinking"), Node sẽ phát sự kiện này vì cả hai nơi
    // gọi runTurn (onTrigger và nhánh flushPending trong finally) đều dùng `void runTurn(...)`,
    // không có handler nào bắt promise bị discard đó.
    const unhandledReasons: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledReasons.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const llm = new DeferredLlmAgent();
      const deps = makeDeps({ llm });
      const { wss, port } = await startServer(deps);
      servers.push(wss);
      const session = sessionManager.create({
        sessionId: "s11", tokenHash: hashToken("tok"), problem: PROBLEM, language: "python", clock: deps.clock,
      });

      const ws = new WebSocket(`ws://localhost:${port}/ws/session/s11?token=tok`);
      await new Promise((resolve) => ws.once("open", resolve));

      // Lượt stage_enter khởi động ngay khi kết nối và hiện đang kẹt ở "thinking" mãi mãi (chat()
      // của DeferredLlmAgent không tự resolve). Ngắt lời nó TRƯỚC KHI nó có cơ hội bắt đầu nói.
      const cancelledPromise = waitForType(ws, "ai.speech.cancelled");
      ws.send(JSON.stringify({ type: "speech.start" }));
      const cancelled = await cancelledPromise;
      // Chưa từng có turnId nào được cấp phát cho lượt này (TurnRunner chưa kịp trả lời) — gửi
      // utteranceId rỗng là hành vi có chủ đích, xem chú thích tại onInterrupt trong ws-gateway.ts.
      expect(cancelled.data.utteranceId).toBe("");

      // Đợi promise bị abort của turnRunner.run() settle (reject) và runTurn's catch/finally chạy
      // xong. Nếu bug còn tồn tại, unhandledRejection sẽ được Node phát ra đâu đó trong lúc này.
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(session.aiStatus).toBe("listening");
      expect(session.currentTurnController).toBeNull();
      expect(session.interruptions).toBeGreaterThanOrEqual(1);
      // Không có Turn nào được tạo ra cho lượt bị ngắt lúc còn đang "thinking".
      expect(session.turns.length).toBe(0);

      // Gateway vẫn hoạt động bình thường sau đó (busy đã được reset đúng, không bị kẹt) — một
      // thông điệp code.run mới vẫn được xử lý và trả lời ngay.
      const resultPromise = waitForType(ws, "code.result");
      ws.send(JSON.stringify({ type: "code.run" }));
      const resultMsg = await resultPromise;
      expect(resultMsg.data.mode).toBe("sample");

      ws.close();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(unhandledReasons).toEqual([]);
  });
});
