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
