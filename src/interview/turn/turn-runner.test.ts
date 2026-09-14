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
