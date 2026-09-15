import { describe, it, expect, afterEach, vi } from "vitest";
import { OllamaLlmAgent, checkOllamaHasModel } from "./ollama-llm-agent";

describe("OllamaLlmAgent.chat (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gọi /api/chat với model, messages, format=json khi opts.json=true và trả về content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: '{"action":"speak","reply":"ok"}' } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const agent = new OllamaLlmAgent("http://127.0.0.1:11434", "qwen2.5:7b-instruct");
    const messages = [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "u" }];
    const res = await agent.chat(messages, { signal: new AbortController().signal, maxTokens: 400, json: true });

    expect(res).toBe('{"action":"speak","reply":"ok"}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "qwen2.5:7b-instruct", messages, stream: false, format: "json", options: { num_predict: 400 } });
  });

  it("không set format khi opts.json=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { role: "assistant", content: "hi" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const agent = new OllamaLlmAgent("http://127.0.0.1:11434", "qwen2.5:7b-instruct");
    await agent.chat([], { signal: new AbortController().signal, maxTokens: 100, json: false });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.format).toBeUndefined();
  });

  it("ném lỗi khi response không ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const agent = new OllamaLlmAgent("http://127.0.0.1:11434", "qwen2.5:7b-instruct");
    await expect(agent.chat([], { signal: new AbortController().signal, maxTokens: 100, json: true })).rejects.toThrow("Ollama HTTP 500");
  });

  it("ném lỗi khi fetch reject (Ollama không chạy)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const agent = new OllamaLlmAgent("http://127.0.0.1:11434", "qwen2.5:7b-instruct");
    await expect(agent.chat([], { signal: new AbortController().signal, maxTokens: 100, json: true })).rejects.toThrow("ECONNREFUSED");
  });
});

describe("checkOllamaHasModel (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("true khi model có trong danh sách /api/tags", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: "qwen2.5:7b-instruct" }, { name: "bge-m3:latest" }] }) }));
    expect(await checkOllamaHasModel("http://127.0.0.1:11434", "qwen2.5:7b-instruct")).toBe(true);
  });

  it("false khi model không có trong danh sách", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: "bge-m3:latest" }] }) }));
    expect(await checkOllamaHasModel("http://127.0.0.1:11434", "qwen2.5:7b-instruct")).toBe(false);
  });

  it("false khi Ollama không chạy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await checkOllamaHasModel("http://127.0.0.1:11434", "qwen2.5:7b-instruct")).toBe(false);
  });
});
