import { describe, it, expect } from "vitest";
import { runTestSuite } from "./code-runner";
import { FakeCodeExecutor } from "./fakes";

describe("runTestSuite", () => {
  it("chạy lần lượt từng test case và tổng hợp kết quả pass/fail", async () => {
    const executor = new FakeCodeExecutor((req) => ({
      status: "OK",
      stdout: req.stdin === "1" ? "2" : "wrong",
      stderr: "",
      timeMs: 3,
      passed: req.stdin === "1" ? req.expectedOutput === "2" : false,
    }));
    const results = await runTestSuite(
      executor,
      "python",
      "code",
      [
        { id: 1, input: "1", output: "2" },
        { id: 2, input: "9", output: "10" },
      ],
      new AbortController().signal,
    );
    expect(results).toEqual([
      { id: 1, passed: true, actual: "2", expected: "2", timeMs: 3 },
      { id: 2, passed: false, actual: "wrong", expected: "10", timeMs: 3 },
    ]);
  });

  it("trả mảng rỗng khi không có test case nào", async () => {
    const executor = new FakeCodeExecutor(() => ({ status: "OK", stdout: "", stderr: "", timeMs: 0 }));
    const results = await runTestSuite(executor, "python", "code", [], new AbortController().signal);
    expect(results).toEqual([]);
  });
});
