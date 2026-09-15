import type { SttAgent } from "./types";

interface WhisperTranscribeResponse {
  text: string;
}

/** SttAgent thật, gọi 1 model faster-whisper chạy local qua server Python riêng (infra/stt-whisper) — xem docs/superpowers/specs/2026-09-15-ai-interviewer-followup-ideas.md. */
export class WhisperSttAgent implements SttAgent {
  constructor(private baseUrl: string) {}

  async transcribe(wav: Buffer, opts: { signal: AbortSignal; language: "vi" }): Promise<string> {
    const res = await fetch(`${this.baseUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: new Uint8Array(wav),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Whisper STT HTTP ${res.status}`);
    const body = (await res.json()) as WhisperTranscribeResponse;
    return body.text;
  }
}

/** Server Python (infra/stt-whisper) đang chạy chưa — dùng làm 1 nhánh của CompositeModelHealth. */
export async function checkWhisperHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
