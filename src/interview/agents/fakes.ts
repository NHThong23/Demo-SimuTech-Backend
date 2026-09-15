import type { ChatMessage, CodeExecutor, ExecutionResult, LlmAgent, ModelHealth, SttAgent, TtsAgent } from "./types";
import type { Language } from "../domain/types";

export class FakeLlmAgent implements LlmAgent {
  private queue: string[] = [];
  private calls: ChatMessage[][] = [];

  enqueue(response: string): void {
    this.queue.push(response);
  }

  async chat(messages: ChatMessage[], _opts: { signal: AbortSignal; maxTokens: number; json: boolean }): Promise<string> {
    this.calls.push(messages);
    return (
      this.queue.shift() ??
      JSON.stringify({ action: "speak", reply: "OK, mình hiểu rồi.", note: null, revealed_constraints: [], covered_topics: [] })
    );
  }

  get callCount(): number {
    return this.calls.length;
  }

  get lastMessages(): ChatMessage[] | undefined {
    return this.calls.at(-1);
  }
}

export class FakeSttAgent implements SttAgent {
  private queue: string[] = [];

  enqueue(text: string): void {
    this.queue.push(text);
  }

  async transcribe(_wav: Buffer, _opts: { signal: AbortSignal; language: "vi" }): Promise<string> {
    return this.queue.shift() ?? "";
  }
}

export class FakeTtsAgent implements TtsAgent {
  async synthesize(text: string, _opts: { signal: AbortSignal }): Promise<Buffer> {
    // Yield a real event-loop turn (not just a microtask) so tests that exercise a genuine
    // WebSocket round trip mid-speech (e.g. barge-in / interrupt) have a real window to land
    // their message before this fake "finishes speaking" — a real TTS call always takes
    // non-trivial wall-clock time, this just makes the fake behave a bit more like it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Must be valid PCM16 (even byte length) — a real WS client (see src/app/interview-test/page.tsx)
    // decodes every binary frame as Int16Array and crashes on an odd length. A short silent clip
    // (length scaled to the text so longer replies "speak" longer) satisfies that without needing
    // a real TTS call; content doesn't matter since nothing asserts on it beyond length > 0.
    return Buffer.alloc(Math.max(text.length, 1) * 2, 0);
  }
}

export class FakeModelHealth implements ModelHealth {
  constructor(private ready: { qwen: boolean; stt: boolean; tts: boolean } = { qwen: true, stt: true, tts: true }) {}

  async check(): Promise<{ qwen: boolean; stt: boolean; tts: boolean }> {
    return this.ready;
  }
}

export class FakeCodeExecutor implements CodeExecutor {
  constructor(
    private resultFn: (req: { language: Language; code: string; stdin: string; expectedOutput?: string }) => ExecutionResult,
  ) {}

  async run(req: { language: Language; code: string; stdin: string; expectedOutput?: string; signal: AbortSignal }): Promise<ExecutionResult> {
    return this.resultFn(req);
  }
}
