import type { CodeExecutor, ExecutionResult } from "./types";
import type { Language } from "../domain/types";

export const LANGUAGE_TO_JUDGE0_ID: Record<Language, number> = {
  python: 71,
  javascript: 63,
  cpp: 54,
};

interface Judge0SubmissionResult {
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  time: string | null;
}

export function mapJudge0Result(body: Judge0SubmissionResult, expectedOutput?: string): ExecutionResult {
  const timeMs = body.time ? Math.round(parseFloat(body.time) * 1000) : 0;
  const stdout = (body.stdout ?? "").replace(/\s+$/, "");
  const stderr = body.stderr ?? body.compile_output ?? "";
  if (body.status.id === 6) return { status: "COMPILE_ERROR", stdout, stderr, timeMs };
  if (body.status.id === 5) return { status: "TIME_LIMIT", stdout, stderr, timeMs };
  if (body.status.id >= 7 && body.status.id <= 12) return { status: "RUNTIME_ERROR", stdout, stderr, timeMs };
  if (body.status.id !== 3 && body.status.id !== 4) {
    // Any other status id (1/2 in-progress, 13 Internal Error, 14 Exec Format Error,
    // or an unrecognized future id) is not a genuine completion — never treat it as OK.
    return { status: "EXECUTOR_UNAVAILABLE", stdout: "", stderr: "", timeMs: 0 };
  }
  const passed = expectedOutput !== undefined ? body.status.id === 3 : undefined;
  return { status: "OK", stdout, stderr, timeMs, passed };
}

export class Judge0Executor implements CodeExecutor {
  constructor(private baseUrl: string) {}

  async run(req: {
    language: Language; code: string; stdin: string; expectedOutput?: string; signal: AbortSignal;
  }): Promise<ExecutionResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/submissions?base64_encoded=false&wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_code: req.code,
          language_id: LANGUAGE_TO_JUDGE0_ID[req.language],
          stdin: req.stdin,
          expected_output: req.expectedOutput,
          cpu_time_limit: 2,
          memory_limit: 256000,
        }),
        signal: req.signal,
      });
    } catch {
      return { status: "EXECUTOR_UNAVAILABLE", stdout: "", stderr: "", timeMs: 0 };
    }
    if (!res.ok) return { status: "EXECUTOR_UNAVAILABLE", stdout: "", stderr: "", timeMs: 0 };
    let body: Judge0SubmissionResult;
    try {
      body = (await res.json()) as Judge0SubmissionResult;
    } catch {
      return { status: "EXECUTOR_UNAVAILABLE", stdout: "", stderr: "", timeMs: 0 };
    }
    return mapJudge0Result(body, req.expectedOutput);
  }
}
