import type { CodeExecutor } from "./types";
import type { Language, TestResultItem } from "../domain/types";

export interface TestSuiteCase {
  id: number;
  input: string;
  output: string;
}

/** Chạy tuần tự từng test case qua executor — giữ tải thấp cho Judge0 local/free tier. */
export async function runTestSuite(
  executor: CodeExecutor,
  language: Language,
  code: string,
  cases: TestSuiteCase[],
  signal: AbortSignal,
): Promise<TestResultItem[]> {
  const results: TestResultItem[] = [];
  for (const c of cases) {
    const res = await executor.run({ language, code, stdin: c.input, expectedOutput: c.output, signal });
    results.push({ id: c.id, passed: res.passed ?? false, actual: res.stdout, expected: c.output, timeMs: res.timeMs });
  }
  return results;
}
