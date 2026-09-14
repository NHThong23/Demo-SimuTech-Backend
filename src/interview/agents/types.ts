import type { ExecStatus, Language } from "../domain/types";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

export interface LlmAgent {
  chat(messages: ChatMessage[], opts: { signal: AbortSignal; maxTokens: number; json: boolean }): Promise<string>;
}
export interface SttAgent {
  transcribe(wav: Buffer, opts: { signal: AbortSignal; language: "vi" }): Promise<string>;
}
export interface TtsAgent {
  synthesize(text: string, opts: { signal: AbortSignal }): Promise<Buffer>;
}
export interface ModelHealth {
  check(): Promise<{ qwen: boolean; stt: boolean; tts: boolean }>;
}
export interface ExecutionResult {
  status: ExecStatus;
  stdout: string;
  stderr: string;
  timeMs: number;
  passed?: boolean;
}
export interface CodeExecutor {
  run(req: { language: Language; code: string; stdin: string; expectedOutput?: string; signal: AbortSignal }): Promise<ExecutionResult>;
}
