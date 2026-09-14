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
    return Buffer.from(`FAKE_AUDIO:${text}`, "utf8");
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
