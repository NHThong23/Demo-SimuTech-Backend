import { describe, it, expect } from "vitest";
import { evaluateStageEvent } from "./stage-machine";

describe("evaluateStageEvent", () => {
  it("chặng 1: llm_next_stage chuyển ngay dù chưa đạt minSec", () => {
    const r = evaluateStageEvent(
      { currentStage: 1, elapsedSec: 60, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "llm_next_stage" },
    );
    expect(r).toMatchObject({ transitioned: true, forced: false, nextStage: 2 });
  });

  it("chặng 3: stage_done_button bị từ chối nếu chưa chạy code lần nào", () => {
    const r = evaluateStageEvent(
      { currentStage: 3, elapsedSec: 1000, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "stage_done_button" },
    );
    expect(r.transitioned).toBe(false);
    expect(r.rejected).toMatchObject({ code: "STAGE_PRECONDITION" });
  });

  it("chặng 3: stage_done_button được chấp nhận nếu đã chạy code >= 1 lần", () => {
    const r = evaluateStageEvent(
      { currentStage: 3, elapsedSec: 1000, codeRunCountThisStage: 1, hiddenTestsAllPassed: false },
      { type: "stage_done_button" },
    );
    expect(r).toMatchObject({ transitioned: true, nextStage: 4 });
  });

  it("chặng 4: hidden_tests_passed tự động chuyển", () => {
    const r = evaluateStageEvent(
      { currentStage: 4, elapsedSec: 100, codeRunCountThisStage: 3, hiddenTestsAllPassed: true },
      { type: "hidden_tests_passed" },
    );
    expect(r).toMatchObject({ transitioned: true, nextStage: 5 });
  });

  it("chặng 4: hidden_tests_passed không có tác dụng nếu chưa pass hết", () => {
    const r = evaluateStageEvent(
      { currentStage: 4, elapsedSec: 100, codeRunCountThisStage: 3, hiddenTestsAllPassed: false },
      { type: "hidden_tests_passed" },
    );
    expect(r.transitioned).toBe(false);
  });

  it("tick: cảnh báo ở 80% maxSec, không chuyển", () => {
    // chặng 1 maxSec = 300s -> 80% = 240s
    const r = evaluateStageEvent(
      { currentStage: 1, elapsedSec: 240, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "tick" },
    );
    expect(r).toMatchObject({ transitioned: false, timeWarning: true });
  });

  it("tick: bắt buộc chuyển khi hết maxSec, kể cả chặng 3 chưa chạy code", () => {
    const r = evaluateStageEvent(
      { currentStage: 3, elapsedSec: 1500, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "tick" },
    );
    expect(r).toMatchObject({ transitioned: true, forced: true, nextStage: 4 });
  });

  it("chặng 6: stage_done_button kết thúc phiên (nextStage null)", () => {
    const r = evaluateStageEvent(
      { currentStage: 6, elapsedSec: 30, codeRunCountThisStage: 0, hiddenTestsAllPassed: false },
      { type: "stage_done_button" },
    );
    expect(r).toMatchObject({ transitioned: true, nextStage: null });
  });
});
