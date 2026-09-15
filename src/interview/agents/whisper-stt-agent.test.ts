import { describe, it, expect, afterEach, vi } from "vitest";
import { WhisperSttAgent, checkWhisperHealth } from "./whisper-stt-agent";

describe("WhisperSttAgent.transcribe (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gửi WAV bytes tới /transcribe và trả về text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: "xin chào" }) });
    vi.stubGlobal("fetch", fetchMock);
    const agent = new WhisperSttAgent("http://127.0.0.1:8200");
    const wav = Buffer.from("RIFF....WAVEfmt ", "utf8");
    const res = await agent.transcribe(wav, { signal: new AbortController().signal, language: "vi" });

    expect(res).toBe("xin chào");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8200/transcribe");
    expect(Buffer.from(init.body)).toEqual(wav);
  });

  it("ném lỗi khi response không ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const agent = new WhisperSttAgent("http://127.0.0.1:8200");
    await expect(agent.transcribe(Buffer.from(""), { signal: new AbortController().signal, language: "vi" })).rejects.toThrow("Whisper STT HTTP 500");
  });

  it("ném lỗi khi fetch reject (server không chạy)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const agent = new WhisperSttAgent("http://127.0.0.1:8200");
    await expect(agent.transcribe(Buffer.from(""), { signal: new AbortController().signal, language: "vi" })).rejects.toThrow("ECONNREFUSED");
  });
});

describe("checkWhisperHealth (mock fetch)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("true khi /health trả ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkWhisperHealth("http://127.0.0.1:8200")).toBe(true);
  });

  it("false khi server không chạy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await checkWhisperHealth("http://127.0.0.1:8200")).toBe(false);
  });
});
