import { describe, it, expect } from "vitest";
import { FakeLlmAgent, FakeSttAgent, FakeTtsAgent, FakeModelHealth, FakeCodeExecutor } from "./fakes";

describe("FakeLlmAgent", () => {
  it("trả về response đã enqueue theo thứ tự FIFO", async () => {
    const agent = new FakeLlmAgent();
    agent.enqueue('{"a":1}');
    agent.enqueue('{"a":2}');
    const signal = new AbortController().signal;
    await expect(agent.chat([], { signal, maxTokens: 10, json: true })).resolves.toBe('{"a":1}');
    await expect(agent.chat([], { signal, maxTokens: 10, json: true })).resolves.toBe('{"a":2}');
  });

  it("trả về JSON hợp lệ mặc định khi hàng đợi rỗng", async () => {
    const agent = new FakeLlmAgent();
    const raw = await agent.chat([], { signal: new AbortController().signal, maxTokens: 10, json: true });
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("ghi lại messages đã nhận cho việc assert trong test khác", async () => {
    const agent = new FakeLlmAgent();
    const messages = [{ role: "user" as const, content: "hi" }];
    await agent.chat(messages, { signal: new AbortController().signal, maxTokens: 10, json: true });
    expect(agent.callCount).toBe(1);
    expect(agent.lastMessages).toEqual(messages);
  });
});

describe("FakeSttAgent", () => {
  it("trả về transcript đã enqueue, mặc định rỗng", async () => {
    const agent = new FakeSttAgent();
    agent.enqueue("xin chào");
    const opts = { signal: new AbortController().signal, language: "vi" as const };
    await expect(agent.transcribe(Buffer.from([]), opts)).resolves.toBe("xin chào");
    await expect(agent.transcribe(Buffer.from([]), opts)).resolves.toBe("");
  });
});

describe("FakeTtsAgent", () => {
  it("trả về Buffer khác rỗng cho mọi câu", async () => {
    const agent = new FakeTtsAgent();
    const audio = await agent.synthesize("xin chào", { signal: new AbortController().signal });
    expect(audio.length).toBeGreaterThan(0);
  });
});

describe("FakeModelHealth", () => {
  it("mặc định báo cả 3 model sẵn sàng", async () => {
    const health = new FakeModelHealth();
    await expect(health.check()).resolves.toEqual({ qwen: true, stt: true, tts: true });
  });

  it("cho phép ép trạng thái không sẵn sàng để test lỗi 503", async () => {
    const health = new FakeModelHealth({ qwen: false, stt: true, tts: true });
    await expect(health.check()).resolves.toEqual({ qwen: false, stt: true, tts: true });
  });
});

describe("FakeCodeExecutor", () => {
  it("gọi hàm resultFn được truyền vào với đúng request", async () => {
    const executor = new FakeCodeExecutor((req) => ({
      status: req.stdin === "ok" ? "OK" : "RUNTIME_ERROR",
      stdout: req.stdin,
      stderr: "",
      timeMs: 5,
      passed: req.expectedOutput === req.stdin,
    }));
    const res = await executor.run({ language: "python", code: "x", stdin: "ok", expectedOutput: "ok", signal: new AbortController().signal });
    expect(res).toEqual({ status: "OK", stdout: "ok", stderr: "", timeMs: 5, passed: true });
  });
});
