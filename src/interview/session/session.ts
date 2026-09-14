import type {
  AiStatus, CodeRunResult, Language, Problem, SessionStatus, Stage,
  StageConfig, Turn, WhiteboardState,
} from "../domain/types";
import { getStageConfig } from "../config/stages";
import type { Clock } from "./clock";
import { evaluateStageEvent, type StageMachineEvent, type StageMachineResult } from "./stage-machine";

export interface SessionOptions {
  sessionId: string;
  tokenHash: string;
  problem: Problem;
  language: Language;
  userId?: string;
  clock: Clock;
}

export interface SessionSnapshot {
  problem: Problem;
  language: Language;
  currentStage: Stage;
  stageElapsedSec: number;
  stageConfig: StageConfig;
  recentTurns: Turn[];
  latestCode: string;
  latestBoard: WhiteboardState | null;
  revealedConstraints: number[];
  coveredTopics: number[];
  lastCodeRun: CodeRunResult | null;
  hiddenTestsPassed: number;
  hiddenTestsTotal: number;
}

export class Session {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly problem: Problem;
  readonly language: Language;
  readonly userId?: string;
  status: SessionStatus = "active";
  aiStatus: AiStatus = "idle";
  currentStage: Stage = 1;
  latestCode = "";
  latestBoardByStage: Partial<Record<Stage, WhiteboardState>> = {};
  turns: Turn[] = [];
  codeRuns: CodeRunResult[] = [];
  revealedConstraints = new Set<number>();
  coveredTopics = new Set<number>();
  hintsGiven = 0;
  interruptions = 0;
  forcedTransitions: Stage[] = [];
  stageDurationsSec: Record<string, number> = {};
  hiddenTestsPassed = 0;
  hiddenTestsTotal = 0;
  currentTurnController: AbortController | null = null;

  private clock: Clock;
  private stageEnteredAtMs: number;
  private codeRunCountThisStage = 0;

  constructor(opts: SessionOptions) {
    this.sessionId = opts.sessionId;
    this.tokenHash = opts.tokenHash;
    this.problem = opts.problem;
    this.language = opts.language;
    this.userId = opts.userId;
    this.clock = opts.clock;
    this.stageEnteredAtMs = opts.clock.now();
  }

  get stageElapsedSec(): number {
    return Math.floor((this.clock.now() - this.stageEnteredAtMs) / 1000);
  }

  recordCodeRun(result: CodeRunResult): void {
    this.codeRuns.push(result);
    this.codeRunCountThisStage += 1;
  }

  recordTurn(turn: Turn): void {
    this.turns.push(turn);
    if (turn.role === "ai" && turn.action === "speak" && turn.trigger === "silence") this.hintsGiven += 1;
  }

  get recentTurns(): Turn[] {
    return this.turns.slice(-20);
  }

  markInterrupted(turnId: string): void {
    const turn = this.turns.find((t) => t.turnId === turnId);
    if (turn) turn.interrupted = true;
    this.interruptions += 1;
  }

  applyLlmReveal(output: { revealed_constraints: number[]; covered_topics: number[] }): void {
    for (const i of output.revealed_constraints) this.revealedConstraints.add(i);
    for (const i of output.covered_topics) this.coveredTopics.add(i);
  }

  updateHiddenTestProgress(passed: number, total: number): void {
    this.hiddenTestsPassed = passed;
    this.hiddenTestsTotal = total;
  }

  attemptTransition(event: StageMachineEvent): StageMachineResult {
    if (this.status !== "active") {
      return { transitioned: false, forced: false, timeWarning: false, nextStage: null };
    }
    const result = evaluateStageEvent(
      {
        currentStage: this.currentStage,
        elapsedSec: this.stageElapsedSec,
        codeRunCountThisStage: this.codeRunCountThisStage,
        hiddenTestsAllPassed:
          this.currentStage === 4 && this.hiddenTestsTotal > 0 && this.hiddenTestsPassed === this.hiddenTestsTotal,
      },
      event,
    );
    if (result.transitioned) {
      const now = this.clock.now();
      this.stageDurationsSec[String(this.currentStage)] = Math.floor((now - this.stageEnteredAtMs) / 1000);
      if (result.forced) this.forcedTransitions.push(this.currentStage);
      if (result.nextStage === null) {
        this.status = "completed";
      } else {
        this.currentStage = result.nextStage;
        this.stageEnteredAtMs = now;
        this.codeRunCountThisStage = 0;
      }
    }
    return result;
  }

  toSnapshot(): SessionSnapshot {
    const latestBoard = this.latestBoardByStage[this.currentStage];
    const lastCodeRun = this.codeRuns.at(-1);

    return {
      problem: this.problem,
      language: this.language,
      currentStage: this.currentStage,
      stageElapsedSec: this.stageElapsedSec,
      stageConfig: getStageConfig(this.currentStage),
      recentTurns: this.recentTurns.map((turn) => ({ ...turn })),
      latestCode: this.latestCode,
      latestBoard: latestBoard
        ? {
            ...latestBoard,
            nodes: [...latestBoard.nodes],
            edges: [...latestBoard.edges],
          }
        : null,
      revealedConstraints: [...this.revealedConstraints],
      coveredTopics: [...this.coveredTopics],
      lastCodeRun: lastCodeRun
        ? {
            ...lastCodeRun,
            tests: [...lastCodeRun.tests],
          }
        : null,
      hiddenTestsPassed: this.hiddenTestsPassed,
      hiddenTestsTotal: this.hiddenTestsTotal,
    };
  }
}
