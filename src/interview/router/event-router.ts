import type { Clock } from "../session/clock";
import type { CodeRunResult, TriggerType } from "../domain/types";

export type TriggerPayload =
  | { kind: "utterance"; transcript: string }
  | { kind: "code_result"; result: CodeRunResult }
  | { kind: "whiteboard_done" }
  | { kind: "stage_enter" }
  | { kind: "silence" }
  | { kind: "time_warning" };

export interface EventRouterOptions {
  clock: Clock;
  getSilenceThresholdSec: () => number;
  getStageElapsedSec: () => number;
  getStageMaxSec: () => number;
  isBusy: () => boolean;
  onTrigger: (trigger: TriggerType, payload: TriggerPayload) => void;
  onInterrupt: () => void;
  onStagePrecondition: (message: string) => void;
  canDoneStage: () => { ok: true } | { ok: false; message: string };
  tickIntervalMs?: number;
}

export class EventRouter {
  private silenceTimer: unknown = null;
  private tickTimer: unknown = null;
  private silenceFiredForCurrentActivity = false;
  private timeWarningFiredForStage = false;
  private pendingTriggers: TriggerPayload[] = [];

  constructor(private opts: EventRouterOptions) {
    this.scheduleTick();
  }

  dispose(): void {
    this.clearSilenceTimer();
    this.clearTick();
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      this.opts.clock.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearTick(): void {
    if (this.tickTimer !== null) {
      this.opts.clock.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private scheduleTick(): void {
    this.clearTick();
    this.tickTimer = this.opts.clock.setTimeout(() => this.onTick(), this.opts.tickIntervalMs ?? 5000);
  }

  private onTick(): void {
    const elapsed = this.opts.getStageElapsedSec();
    const max = this.opts.getStageMaxSec();
    if (!this.timeWarningFiredForStage && elapsed >= max * 0.8) {
      this.timeWarningFiredForStage = true;
      this.emit({ kind: "time_warning" });
    }
    this.scheduleTick();
  }

  onStageEntered(): void {
    this.timeWarningFiredForStage = false;
    this.resetSilenceTimer();
    this.emit({ kind: "stage_enter" });
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceFiredForCurrentActivity = false;
    const ms = this.opts.getSilenceThresholdSec() * 1000;
    this.silenceTimer = this.opts.clock.setTimeout(() => this.onSilenceElapsed(), ms);
  }

  private onSilenceElapsed(): void {
    if (this.silenceFiredForCurrentActivity) return;
    this.silenceFiredForCurrentActivity = true;
    this.emit({ kind: "silence" });
  }

  private recordActivity(): void {
    this.resetSilenceTimer();
  }

  private emit(payload: TriggerPayload): void {
    if (this.opts.isBusy()) {
      this.pendingTriggers.push(payload);
      return;
    }
    this.opts.onTrigger(payload.kind, payload);
  }

  /** Lấy hết trigger đang chờ (gọi sau khi một lượt vừa chạy xong). */
  flushPending(): TriggerPayload[] {
    const pending = this.pendingTriggers;
    this.pendingTriggers = [];
    return pending;
  }

  handleSpeechStart(): void {
    this.recordActivity();
    if (this.opts.isBusy()) {
      this.opts.onInterrupt();
      this.pendingTriggers = [];
    }
  }

  handleSpeechEnd(transcript: string): void {
    if (!transcript) return;
    this.recordActivity();
    this.emit({ kind: "utterance", transcript });
  }

  handleEditorUpdate(): void {
    this.recordActivity();
  }

  handleWhiteboardUpdate(): void {
    this.recordActivity();
  }

  handleCodeRunResult(result: CodeRunResult): void {
    this.recordActivity();
    this.emit({ kind: "code_result", result });
  }

  handleWhiteboardDone(): void {
    this.recordActivity();
    this.emit({ kind: "whiteboard_done" });
  }

  handleStageDone(): { accepted: boolean } {
    const check = this.opts.canDoneStage();
    if (!check.ok) {
      this.opts.onStagePrecondition(check.message);
      return { accepted: false };
    }
    return { accepted: true };
  }

  handleAiFinishedSpeaking(): void {
    this.recordActivity();
  }
}
