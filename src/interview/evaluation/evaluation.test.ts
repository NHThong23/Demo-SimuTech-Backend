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
