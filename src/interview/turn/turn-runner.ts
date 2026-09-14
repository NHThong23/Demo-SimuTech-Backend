import { randomUUID } from "node:crypto";
import type { LlmAgent, TtsAgent } from "../agents/types";
import type { LlmAction, LlmTurnOutput, Turn, TriggerType } from "../domain/types";
import type { SessionSnapshot } from "../session/session";
import type { TriggerPayload } from "../router/event-router";
import { buildPrompt } from "./prompt-builder";
import { parseLlmOutput } from "./llm-output-parser";

export interface TurnOutputSink {
  onAiReply(utteranceId: string, text: string): void;
  onAiSpeechStart(utteranceId: string): void;
  onAiSpeechChunk(utteranceId: string, chunk: Buffer): void;
  onAiSpeechEnd(utteranceId: string): void;
}

export interface TurnContext {
  session: SessionSnapshot;
  trigger: TriggerType;
  payload: TriggerPayload;
  signal: AbortSignal;
}

export interface TurnRunnerDeps {
  llm: LlmAgent;
  tts: TtsAgent;
  sink: TurnOutputSink;
}

export interface TurnRunResult {
  turn: Turn;
  stageAction: LlmAction;
  revealedConstraints: number[];
  coveredTopics: number[];
}

const RETRY_INSTRUCTION =
  "Định dạng JSON của bạn không hợp lệ. Hãy trả lời lại đúng định dạng JSON đã yêu cầu, không thêm chữ nào khác.";
const FALLBACK_TEXT = "Bạn cho mình vài giây nhé.";

export class TurnRunner {
  constructor(private deps: TurnRunnerDeps) {}

  async run(ctx: TurnContext): Promise<TurnRunResult> {
    const startedAt = Date.now();
    const messages = buildPrompt(ctx.session, ctx.trigger, ctx.payload);

    let raw = "";
    let llmFailed = false;
    try {
      raw = await this.deps.llm.chat(messages, { signal: ctx.signal, maxTokens: 400, json: true });
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      llmFailed = true;
    }

    let output: LlmTurnOutput;
    if (llmFailed) {
      output = { action: "listen", reply: FALLBACK_TEXT, note: null, revealed_constraints: [], covered_topics: [] };
    } else {
      let parsed = parseLlmOutput(raw);
      if (!parsed.ok) {
        try {
          raw = await this.deps.llm.chat([...messages, { role: "user", content: RETRY_INSTRUCTION }], {
            signal: ctx.signal,
            maxTokens: 400,
            json: true,
          });
          parsed = parseLlmOutput(raw);
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          llmFailed = true;
        }
      }
      output = llmFailed
        ? { action: "listen", reply: FALLBACK_TEXT, note: null, revealed_constraints: [], covered_topics: [] }
        : parsed.ok
          ? parsed.value
          : { action: "speak", reply: raw, note: null, revealed_constraints: [], covered_topics: [] };
    }

    const llmMs = Date.now() - startedAt;
    const turn: Turn = {
      turnId: randomUUID(),
      role: "ai",
      stage: ctx.session.currentStage,
      trigger: ctx.trigger,
      text: output.reply,
      action: output.action,
      note: output.note ?? undefined,
      interrupted: false,
      createdAt: new Date().toISOString(),
      latencyMs: { llm: llmMs },
      ...(llmFailed ? { error: "LLM_UNAVAILABLE" } : {}),
    };

    if (output.reply) {
      await this.speak(turn, ctx.signal);
    }

    return {
      turn,
      stageAction: output.action,
      revealedConstraints: output.revealed_constraints,
      coveredTopics: output.covered_topics,
    };
  }

  private async speak(turn: Turn, signal: AbortSignal): Promise<void> {
    this.deps.sink.onAiSpeechStart(turn.turnId);
    this.deps.sink.onAiReply(turn.turnId, turn.text);
    const sentences = turn.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const ttsStart = Date.now();
    let first = true;
    for (const sentence of sentences) {
      if (signal.aborted) return;
      const audio = await this.deps.tts.synthesize(sentence, { signal });
      if (first) {
        turn.latencyMs = { ...turn.latencyMs, ttsFirstAudio: Date.now() - ttsStart };
        first = false;
      }
      this.deps.sink.onAiSpeechChunk(turn.turnId, audio);
    }
    turn.latencyMs = { ...turn.latencyMs, ttsTotal: Date.now() - ttsStart };
    this.deps.sink.onAiSpeechEnd(turn.turnId);
  }
}
