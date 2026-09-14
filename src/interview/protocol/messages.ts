import { z } from "zod";
import type { Language } from "../domain/types";

const LanguageSchema = z.enum(["python", "javascript", "cpp"]) satisfies z.ZodType<Language>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("speech.start") }),
  z.object({ type: z.literal("speech.pause") }),
  z.object({ type: z.literal("speech.end") }),
  z.object({
    type: z.literal("editor.update"),
    data: z.object({ code: z.string().max(65536), language: LanguageSchema }),
  }),
  z.object({
    type: z.literal("code.run"),
    data: z.object({ customInput: z.string().max(65536).optional() }).optional(),
  }),
  z.object({
    type: z.literal("whiteboard.update"),
    data: z.object({
      nodes: z
        .array(z.object({ id: z.string(), label: z.string(), x: z.number(), y: z.number() }))
        .max(200),
      edges: z
        .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() }))
        .max(400),
    }),
  }),
  z.object({ type: z.literal("whiteboard.done") }),
  z.object({ type: z.literal("stage.done") }),
  z.object({ type: z.literal("session.end") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | {
      type: "session.state";
      data: {
        stage: number;
        stageName: string;
        stageElapsedSec: number;
        stageMinSec: number;
        stageMaxSec: number;
        silenceThresholdSec: number;
        aiStatus: "idle" | "listening" | "transcribing" | "thinking" | "speaking";
        status: "active" | "completed" | "abandoned";
      };
    }
  | { type: "transcript.user"; data: { utteranceId: string; text: string } }
  | { type: "ai.reply"; data: { utteranceId: string; text: string } }
  | { type: "ai.speech.start"; data: { utteranceId: string; sampleRate: 24000; format: "pcm16" } }
  | { type: "ai.speech.end"; data: { utteranceId: string } }
  | { type: "ai.speech.cancelled"; data: { utteranceId: string } }
  | {
      type: "code.result";
      data: {
        runId: string;
        mode: "sample" | "custom";
        status: string;
        tests?: unknown[];
        output?: { stdout: string; stderr: string; timeMs: number };
      };
    }
  | { type: "session.evaluation"; data: unknown }
  | { type: "error"; data: { code: string; message: string; retryable: boolean } };

export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClientMessage(raw: string): { ok: true; value: ClientMessage } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  const result = ClientMessageSchema.safeParse(data);
  if (!result.success) return { ok: false, error: "INVALID_MESSAGE" };
  return { ok: true, value: result.data };
}
