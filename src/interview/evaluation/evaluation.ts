import { z } from "zod";
import type { LlmAgent } from "../agents/types";
import type { EvaluationResult, Problem, Stage, Turn } from "../domain/types";

export interface EvaluationInput {
  problem: Problem;
  revealedConstraints: number[];
  coveredTopics: number[];
  hintsGiven: number;
  codeRunsCount: number;
  interruptions: number;
  stageDurationsSec: Record<string, number>;
  forcedTransitions: Stage[];
  hiddenTestsPassed: number;
  hiddenTestsTotal: number;
  recentTurns: Turn[];
  allNotes: string[];
  latestCode: string;
}

export function computeObjectiveMetrics(input: EvaluationInput): EvaluationResult["objective"] {
  return {
    hidden_tests_passed: input.hiddenTestsPassed,
    hidden_tests_total: input.hiddenTestsTotal,
    constraints_clarified: input.revealedConstraints.length,
    constraints_total: input.problem.hidden_constraints?.length ?? 0,
    hints_given: input.hintsGiven,
    code_runs: input.codeRunsCount,
    interruptions: input.interruptions,
    stage_durations_sec: input.stageDurationsSec,
    forced_transitions: input.forcedTransitions,
  };
}

const PillarSchema = z.object({ strengths: z.array(z.string()), improvements: z.array(z.string()) });
const EvaluationOutputSchema = z.object({
  pillars: z.object({
    problem_solving: PillarSchema,
    code_quality: PillarSchema,
    testing_debugging: PillarSchema,
    communication: PillarSchema,
  }),
  summary: z.string(),
});

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function parseEvaluationOutput(raw: string): { ok: true; value: z.infer<typeof EvaluationOutputSchema> } | { ok: false } {
  const jsonText = extractJson(raw);
  if (!jsonText) return { ok: false };
  try {
    const data = JSON.parse(jsonText);
    const result = EvaluationOutputSchema.safeParse(data);
    return result.success ? { ok: true, value: result.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function buildEvaluationPrompt(input: EvaluationInput): { role: "system" | "user"; content: string }[] {
  const transcript = input.recentTurns.map((t) => `[${t.role}] ${t.text}`).join("\n");
  return [
    {
      role: "system",
      content:
        'Bạn viết nhận xét cuối buổi phỏng vấn thử theo 4 trụ cột: problem_solving, code_quality, testing_debugging, communication. ' +
        'KHÔNG chấm điểm số, chỉ nhận xét định tính. Trả về đúng JSON: ' +
        '{"pillars":{"problem_solving":{"strengths":[],"improvements":[]},"code_quality":{"strengths":[],"improvements":[]},"testing_debugging":{"strengths":[],"improvements":[]},"communication":{"strengths":[],"improvements":[]}},"summary":"..."}',
    },
    {
      role: "user",
      content: [
        `Đề bài: ${input.problem.title}`,
        `Ghi chú tích lũy trong buổi: ${input.allNotes.join(" | ") || "(không có)"}`,
        `Code cuối cùng:\n${input.latestCode}`,
        `Transcript gần đây:\n${transcript}`,
      ].join("\n\n"),
    },
  ];
}

export async function buildEvaluation(llm: LlmAgent, input: EvaluationInput): Promise<EvaluationResult> {
  const objective = computeObjectiveMetrics(input);
  try {
    const raw = await llm.chat(buildEvaluationPrompt(input), {
      signal: new AbortController().signal,
      maxTokens: 800,
      json: true,
    });
    const parsed = parseEvaluationOutput(raw);
    if (parsed.ok) {
      return { pillars: parsed.value.pillars, objective, summary: parsed.value.summary };
    }
  } catch {
    // rơi xuống nhánh mặc định bên dưới
  }
  return { pillars: null, objective, summary: "Không tạo được nhận xét tự động." };
}
