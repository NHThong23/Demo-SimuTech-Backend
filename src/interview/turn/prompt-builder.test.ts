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
