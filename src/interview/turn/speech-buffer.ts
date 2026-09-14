import type { SttAgent } from "../agents/types";

export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class SpeechBuffer {
  private chunks: Buffer[] = [];
  private lastTranscribedAtChunkCount = 0;
  private cachedTranscript = "";

  constructor(private stt: SttAgent, private sampleRate = 16000) {}

  addChunk(chunk: Buffer): void {
    this.chunks.push(chunk);
  }

  /** Chạy Whisper trước khi ứng viên còn im lặng 0.8s, để bù thời gian chờ khi speech.end tới. */
  async pause(signal: AbortSignal): Promise<void> {
    if (this.chunks.length === this.lastTranscribedAtChunkCount) return;
    const countAtCallTime = this.chunks.length;
    this.cachedTranscript = await this.transcribeAll(signal);
    this.lastTranscribedAtChunkCount = countAtCallTime;
  }

  async end(signal: AbortSignal): Promise<{ transcript: string; sttMs: number }> {
    const startedAt = Date.now();
    const transcript =
      this.chunks.length === this.lastTranscribedAtChunkCount && this.cachedTranscript
        ? this.cachedTranscript
        : await this.transcribeAll(signal);
    const sttMs = Date.now() - startedAt;
    this.reset();
    return { transcript, sttMs };
  }

  reset(): void {
    this.chunks = [];
    this.lastTranscribedAtChunkCount = 0;
    this.cachedTranscript = "";
  }

  private async transcribeAll(signal: AbortSignal): Promise<string> {
    const wav = pcm16ToWav(Buffer.concat(this.chunks), this.sampleRate);
    return this.stt.transcribe(wav, { signal, language: "vi" });
  }
}
