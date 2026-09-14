import { describe, it, expect } from "vitest";
import { pcm16ToWav, SpeechBuffer } from "./speech-buffer";
import type { SttAgent } from "../agents/types";

function countingStt(transcript: string) {
  let calls = 0;
  const stt: SttAgent = {
    async transcribe() {
      calls += 1;
      return transcript;
    },
  };
  return { stt, getCalls: () => calls };
}

describe("pcm16ToWav", () => {
  it("tạo header RIFF/WAVE đúng chuẩn và giữ nguyên dữ liệu PCM", () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const wav = pcm16ToWav(pcm, 16000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.subarray(44)).toEqual(pcm);
  });
});

describe("SpeechBuffer", () => {
  it("end() không pause trước đó thì transcribe toàn bộ chunk đã gom", async () => {
    const { stt, getCalls } = countingStt("xin chào");
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1, 2]));
    buf.addChunk(Buffer.from([3, 4]));
    const { transcript } = await buf.end(new AbortController().signal);
    expect(transcript).toBe("xin chào");
    expect(getCalls()).toBe(1);
  });

  it("pause() rồi end() không có chunk mới thì dùng lại kết quả cache, không gọi STT lần 2", async () => {
    const { stt, getCalls } = countingStt("em dùng hash map");
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1]));
    await buf.pause(new AbortController().signal);
    const { transcript } = await buf.end(new AbortController().signal);
    expect(transcript).toBe("em dùng hash map");
    expect(getCalls()).toBe(1);
  });

  it("có chunk mới sau pause() thì end() transcribe lại toàn bộ", async () => {
    let call = 0;
    const stt: SttAgent = {
      async transcribe() {
        call += 1;
        return call === 1 ? "phần 1" : "phần 1 phần 2";
      },
    };
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1]));
    await buf.pause(new AbortController().signal);
    buf.addChunk(Buffer.from([2]));
    const { transcript } = await buf.end(new AbortController().signal);
    expect(transcript).toBe("phần 1 phần 2");
    expect(call).toBe(2);
  });

  it("end() reset state, nên lượt nói kế tiếp transcribe lại từ đầu", async () => {
    const { stt, getCalls } = countingStt("a");
    const buf = new SpeechBuffer(stt);
    buf.addChunk(Buffer.from([1]));
    await buf.end(new AbortController().signal);
    expect(getCalls()).toBe(1);
    buf.addChunk(Buffer.from([2]));
    await buf.end(new AbortController().signal);
    expect(getCalls()).toBe(2);
  });

  it("pause() đang chờ STT, addChunk() thêm dữ liệu mới khi pause() chưa xong: end() phải transcribe lại toàn bộ", async () => {
    let transcribeResolved = false;
    let resolveTranscribe: (() => void) | null = null;
    const pauseStt: SttAgent = {
      async transcribe() {
        return new Promise<string>((resolve) => {
          resolveTranscribe = () => {
            transcribeResolved = true;
            resolve("phần 1");
          };
        });
      },
    };
    const buf = new SpeechBuffer(pauseStt);
    buf.addChunk(Buffer.from([1]));
    // Gọi pause() nhưng không await, để STT vẫn pending
    const pausePromise = buf.pause(new AbortController().signal);
    // Kiểm chứng STT vẫn chưa hoàn thành
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(transcribeResolved).toBe(false);
    // Thêm chunk mới khi pause() chưa xong
    buf.addChunk(Buffer.from([2]));
    // Để pause() hoàn thành
    resolveTranscribe!();
    await pausePromise;
    // Bây giờ end() phải thấy có chunk mới (2 chunks) nhưng lastTranscribedAtChunkCount = 1
    // nên phải transcribe lại
    let endCallCount = 0;
    const endStt: SttAgent = {
      async transcribe() {
        endCallCount += 1;
        return "phần 1 phần 2";
      },
    };
    const buf2 = new SpeechBuffer(endStt);
    buf2.addChunk(Buffer.from([1]));
    let endPauseResolved = false;
    let endPauseResolve: (() => void) | null = null;
    const buf2PauseStt: SttAgent = {
      async transcribe() {
        return new Promise<string>((resolve) => {
          endPauseResolve = () => {
            endPauseResolved = true;
            resolve("phần 1");
          };
        });
      },
    };
    buf2["stt"] = buf2PauseStt;
    const pausePromise2 = buf2.pause(new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    buf2.addChunk(Buffer.from([2]));
    endPauseResolve!();
    await pausePromise2;
    buf2["stt"] = endStt;
    const { transcript } = await buf2.end(new AbortController().signal);
    expect(transcript).toBe("phần 1 phần 2");
    expect(endCallCount).toBe(1);
  });
});
