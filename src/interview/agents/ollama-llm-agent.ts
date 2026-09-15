import type { ChatMessage, LlmAgent } from "./types";

interface OllamaChatResponse {
  message: { role: string; content: string };
}

interface OllamaTagsResponse {
  models: { name: string }[];
}

/** LlmAgent thật, gọi 1 model chạy local qua Ollama (http://host:11434) — xem docs/superpowers/specs/2026-09-15-ai-interviewer-followup-ideas.md. */
export class OllamaLlmAgent implements LlmAgent {
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  async chat(messages: ChatMessage[], opts: { signal: AbortSignal; maxTokens: number; json: boolean }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: { num_predict: opts.maxTokens },
      }),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const body = (await res.json()) as OllamaChatResponse;
    return body.message.content;
  }
}

/** Ollama đang chạy và đã có sẵn model cấu hình chưa — dùng làm 1 nhánh của CompositeModelHealth. */
export async function checkOllamaHasModel(baseUrl: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return false;
    const body = (await res.json()) as OllamaTagsResponse;
    return body.models.some((m) => m.name === model);
  } catch {
    return false;
  }
}
