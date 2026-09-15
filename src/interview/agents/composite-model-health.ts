import type { ModelHealth } from "./types";

/** Ghép 3 nhánh health-check (qwen/stt/tts) độc lập — mỗi nhánh có thể là "luôn true" (fake) hoặc gọi HTTP thật. */
export class CompositeModelHealth implements ModelHealth {
  constructor(
    private checks: {
      qwen: () => Promise<boolean>;
      stt: () => Promise<boolean>;
      tts: () => Promise<boolean>;
    },
  ) {}

  async check(): Promise<{ qwen: boolean; stt: boolean; tts: boolean }> {
    const [qwen, stt, tts] = await Promise.all([this.checks.qwen(), this.checks.stt(), this.checks.tts()]);
    return { qwen, stt, tts };
  }
}
