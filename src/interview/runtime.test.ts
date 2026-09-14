import { describe, it, expect, afterEach } from "vitest";
import { getInterviewRuntime, resetInterviewRuntimeForTest, setInterviewRuntimeForTest } from "./runtime";

describe("getInterviewRuntime", () => {
  afterEach(() => resetInterviewRuntimeForTest());

  it("trả về cùng một instance ở các lần gọi khác nhau (singleton)", () => {
    const a = getInterviewRuntime();
    const b = getInterviewRuntime();
    expect(a).toBe(b);
  });

  it("có đủ các thành phần cần thiết", () => {
    const runtime = getInterviewRuntime();
    expect(runtime.sessionManager).toBeDefined();
    expect(runtime.problemRepository).toBeDefined();
    expect(runtime.interviewRepository).toBeDefined();
    expect(runtime.agents.codeExecutor).toBeDefined();
    expect(runtime.agents.llm).toBeDefined();
  });

  it("setInterviewRuntimeForTest cho phép ép runtime tùy chỉnh, dùng lại được ở lần gọi sau", () => {
    const custom = getInterviewRuntime();
    resetInterviewRuntimeForTest();
    setInterviewRuntimeForTest(custom);
    expect(getInterviewRuntime()).toBe(custom);
  });
});
