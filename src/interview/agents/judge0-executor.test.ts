import { describe, it, expect, afterEach, vi } from "vitest";
import { Judge0Executor, mapJudge0Result } from "./judge0-executor";

describe("mapJudge0Result", () => {
  it("status id 3 (Accepted) với expectedOutput -> OK, passed true", () => {
    const r = mapJudge0Result({ status: { id: 3, description: "Accepted" }, stdout: "5\n", stderr: null, compile_output: null, time: "0.012" }, "5");
    expect(r).toEqual({ status: "OK", stdout: "5", stderr: "", timeMs: 12, passed: true });
  });

  it("status id 4 (Wrong Answer) -> OK, passed false", () => {
    const r = mapJudge0Result({ status: { id: 4, description: "Wrong Answer" }, stdout: "6\n", stderr: null, compile_output: null, time: "0.01" }, "5");
    expect(r.status).toBe("OK");
    expect(r.passed).toBe(false);
  });

  it("không truyền expectedOutput -> passed undefined", () => {
    const r = mapJudge0Result({ status: { id: 3, description: "Accepted" }, stdout: "5\n", stderr: null, compile_output: null, time: "0.01" });
    expect(r.passed).toBeUndefined();
  });

  it("status id 5 (Time Limit Exceeded) -> TIME_LIMIT", () => {
    const r = mapJudge0Result({ status: { id: 5, description: "Time Limit Exceeded" }, stdout: null, stderr: null, compile_output: null, time: null });
    expect(r.status).toBe("TIME_LIMIT");
  });

  it("status id 6 (Compilation Error) -> COMPILE_ERROR, dùng compile_output làm stderr", () => {
    const r = mapJudge0Result({ status: { id: 6, description: "Compilation Error" }, stdout: null, stderr: null, compile_output: "SyntaxError", time: null });
    expect(r.status).toBe("COMPILE_ERROR");
    expect(r.stderr).toBe("SyntaxError");
  });

  it("status id 11 (Runtime Error SIGSEGV) -> RUNTIME_ERROR", () => {
    const r = mapJudge0Result({ status: { id: 11, description: "Runtime Error (SIGSEGV)" }, stdout: null, stderr: "boom", compile_output: null, time: "0.01" });
    expect(r.status).toBe("RUNTIME_ERROR");
  });
});

describe("Judge0Executor.run — lỗi mạng (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trả EXECUTOR_UNAVAILABLE khi fetch ném lỗi", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({ language: "python", code: "print(1)", stdin: "", signal: new AbortController().signal });
    expect(res.status).toBe("EXECUTOR_UNAVAILABLE");
  });

  it("trả EXECUTOR_UNAVAILABLE khi response không ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({ language: "python", code: "print(1)", stdin: "", signal: new AbortController().signal });
    expect(res.status).toBe("EXECUTOR_UNAVAILABLE");
  });

  it("parse đúng response thành công (mock)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: { id: 3, description: "Accepted" }, stdout: "2\n", stderr: null, compile_output: null, time: "0.01" }),
      }),
    );
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({ language: "python", code: "print(1+1)", stdin: "", expectedOutput: "2", signal: new AbortController().signal });
    expect(res).toEqual({ status: "OK", stdout: "2", stderr: "", timeMs: 10, passed: true });
  });
});

describe("Judge0Executor.run — tích hợp thật (cần Judge0 đang chạy tại localhost:2358)", () => {
  it("chạy code Python thật và nhận kết quả đúng", async () => {
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({
      language: "python", code: "print(1 + 1)", stdin: "", expectedOutput: "2", signal: new AbortController().signal,
    });
    expect(res.status).toBe("OK");
    expect(res.passed).toBe(true);
  });

  it("báo RUNTIME_ERROR với code Python sai cú pháp (Python không có pha compile riêng — SyntaxError là Runtime Error NZEC ở Judge0)", async () => {
    const executor = new Judge0Executor("http://127.0.0.1:2358");
    const res = await executor.run({
      language: "python", code: "def f(:\n  pass", stdin: "", signal: new AbortController().signal,
    });
    expect(res.status).toBe("RUNTIME_ERROR");
  });
});
