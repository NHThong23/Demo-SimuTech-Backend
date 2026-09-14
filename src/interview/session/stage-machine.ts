import type { Stage } from "../domain/types";
import { getStageConfig } from "../config/stages";

export interface StageMachineInput {
  currentStage: Stage;
  elapsedSec: number;
  codeRunCountThisStage: number;
  hiddenTestsAllPassed: boolean;
}

export type StageMachineEvent =
  | { type: "llm_next_stage" }
  | { type: "stage_done_button" }
  | { type: "hidden_tests_passed" }
  | { type: "tick" };

export interface StageMachineResult {
  transitioned: boolean;
  forced: boolean;
  timeWarning: boolean;
  nextStage: Stage | null;
  rejected?: { code: "STAGE_PRECONDITION"; message: string };
}

const NO_TRANSITION: StageMachineResult = { transitioned: false, forced: false, timeWarning: false, nextStage: null };

function nextStageOf(stage: Stage): Stage | null {
  return stage === 6 ? null : ((stage + 1) as Stage);
}

function checkPrecondition(input: StageMachineInput): { ok: true } | { ok: false; message: string } {
  if (input.currentStage === 3 && input.codeRunCountThisStage === 0) {
    return { ok: false, message: "Bạn cần chạy thử code ít nhất 1 lần trước khi qua chặng tiếp theo." };
  }
  return { ok: true };
}

export function evaluateStageEvent(input: StageMachineInput, event: StageMachineEvent): StageMachineResult {
  if (event.type === "tick") {
    const config = getStageConfig(input.currentStage);
    if (input.elapsedSec >= config.maxSec) {
      return { transitioned: true, forced: true, timeWarning: false, nextStage: nextStageOf(input.currentStage) };
    }
    if (input.elapsedSec >= config.maxSec * 0.8) {
      return { ...NO_TRANSITION, timeWarning: true };
    }
    return NO_TRANSITION;
  }

  if (event.type === "hidden_tests_passed") {
    if (input.currentStage === 4 && input.hiddenTestsAllPassed) {
      return { transitioned: true, forced: false, timeWarning: false, nextStage: nextStageOf(input.currentStage) };
    }
    return NO_TRANSITION;
  }

  // llm_next_stage | stage_done_button
  const precondition = checkPrecondition(input);
  if (!precondition.ok) {
    return { ...NO_TRANSITION, rejected: { code: "STAGE_PRECONDITION", message: precondition.message } };
  }
  return { transitioned: true, forced: false, timeWarning: false, nextStage: nextStageOf(input.currentStage) };
}
