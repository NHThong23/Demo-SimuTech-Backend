import { describe, it, expect } from "vitest";
import { CompositeModelHealth } from "./composite-model-health";

describe("CompositeModelHealth.check", () => {
  it("gộp kết quả 3 nhánh độc lập", async () => {
    const health = new CompositeModelHealth({
      qwen: async () => true,
      stt: async () => false,
      tts: async () => true,
    });
    expect(await health.check()).toEqual({ qwen: true, stt: false, tts: true });
  });
});
