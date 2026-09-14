import { z } from "zod";
import type { LlmTurnOutput } from "../domain/types";

const LlmTurnOutputSchema = z.object({
  action: z.enum(["speak", "listen", "next_stage", "end"]),
  reply: z.string(),
  note: z.string().nullable(),
  revealed_constraints: z.array(z.number().int()).default([]),
  covered_topics: z.array(z.number().int()).default([]),
});

export type ParseResult = { ok: true; value: LlmTurnOutput } | { ok: false; error: string };

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export function parseLlmOutput(raw: string): ParseResult {
  const jsonText = extractJson(raw);
  if (jsonText === null) return { ok: false, error: "NO_JSON_FOUND" };
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "INVALID_JSON" };
  }
  const result = LlmTurnOutputSchema.safeParse(data);
  if (!result.success) return { ok: false, error: "SCHEMA_MISMATCH" };
  return { ok: true, value: result.data };
}
