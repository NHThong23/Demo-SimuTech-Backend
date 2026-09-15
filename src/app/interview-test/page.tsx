"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import "@excalidraw/excalidraw/index.css";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { excalidrawToWhiteboardState } from "./excalidraw-to-whiteboard";

const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((m) => m.Excalidraw), { ssr: false });

interface ProblemView {
  problemId: string;
  title: string;
  description: string;
  starterCode: string;
  sampleTests: Array<{ id: number; input: string; output: string }>;
}

export default function InterviewTestPage() {
  const [problem, setProblem] = useState<ProblemView | null>(null);
  const [code, setCode] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [stageInfo, setStageInfo] = useState<string>("");
  const [evaluation, setEvaluation] = useState<unknown>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingCtxRef = useRef<AudioContext | null>(null);
  const whiteboardDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function appendLog(line: string): void {
    setLog((prev) => [...prev, line]);
  }

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }

  function playAudioChunk(buf: ArrayBuffer): void {
    const ctx = getAudioCtx();
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const audioBuffer = ctx.createBuffer(1, float32.length || 1, 24000);
    if (float32.length > 0) audioBuffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const startAt = Math.max(playTimeRef.current, ctx.currentTime);
    source.start(startAt);
    playTimeRef.current = startAt + audioBuffer.duration;
  }

  function handleServerMessage(msg: { type: string; data: any }): void {
    switch (msg.type) {
      case "session.state":
        setStageInfo(
          `Chặng ${msg.data.stage}: ${msg.data.stageName} (${msg.data.stageElapsedSec}s/${msg.data.stageMaxSec}s) — AI: ${msg.data.aiStatus}`,
        );
        return;
      case "transcript.user":
        appendLog(`Bạn: ${msg.data.text}`);
        return;
      case "ai.reply":
        appendLog(`AI: ${msg.data.text}`);
        return;
      case "ai.speech.start":
        playTimeRef.current = getAudioCtx().currentTime;
        return;
      case "code.result":
        appendLog(`Kết quả chạy: ${JSON.stringify(msg.data)}`);
        return;
      case "session.evaluation":
        setEvaluation(msg.data);
        return;
      case "error":
        appendLog(`Lỗi: ${msg.data.code} — ${msg.data.message}`);
        return;
      default:
        return;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/interview/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "python" }),
      });
      const data = await res.json();
      if (cancelled) return;
      setProblem(data.problem);
      setCode(data.problem.starterCode);

      const ws = new WebSocket(`ws://${window.location.host}/ws/session/${data.sessionId}?token=${data.token}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onmessage = (event) => {
        if (typeof event.data === "string") handleServerMessage(JSON.parse(event.data));
        else playAudioChunk(event.data as ArrayBuffer);
      };
    })();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording(): Promise<void> {
    wsRef.current?.send(JSON.stringify({ type: "speech.start" }));
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    streamRef.current = stream;
    const ctx = new AudioContext({ sampleRate: 16000 });
    recordingCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      wsRef.current?.send(int16.buffer);
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    processorRef.current = processor;
  }

  function stopRecording(): void {
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void recordingCtxRef.current?.close();
    recordingCtxRef.current = null;
    wsRef.current?.send(JSON.stringify({ type: "speech.end" }));
  }

  function sendCode(nextCode: string): void {
    setCode(nextCode);
    wsRef.current?.send(JSON.stringify({ type: "editor.update", data: { code: nextCode, language: "python" } }));
  }

  function runCode(): void {
    wsRef.current?.send(JSON.stringify({ type: "code.run" }));
  }

  function handleWhiteboardChange(elements: readonly ExcalidrawElement[], _appState: AppState, _files: BinaryFiles): void {
    // Excalidraw gọi onChange trên từng thay đổi nhỏ (mỗi lần kéo chuột) — debounce để khỏi
    // gửi whiteboard.update dồn dập qua WS trong lúc ứng viên còn đang vẽ dở 1 nét.
    if (whiteboardDebounceRef.current) clearTimeout(whiteboardDebounceRef.current);
    whiteboardDebounceRef.current = setTimeout(() => {
      const data = excalidrawToWhiteboardState(elements);
      wsRef.current?.send(JSON.stringify({ type: "whiteboard.update", data }));
    }, 400);
  }

  function sendBoardDone(): void {
    wsRef.current?.send(JSON.stringify({ type: "whiteboard.done" }));
  }

  function doneStage(): void {
    wsRef.current?.send(JSON.stringify({ type: "stage.done" }));
  }

  function endSession(): void {
    wsRef.current?.send(JSON.stringify({ type: "session.end" }));
  }

  if (!problem) return <p style={{ padding: 16 }}>Đang tạo phiên phỏng vấn...</p>;

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1>{problem.title}</h1>
      <p style={{ whiteSpace: "pre-wrap" }}>{problem.description}</p>
      <p>
        <strong>{stageInfo}</strong>
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onMouseDown={startRecording} onMouseUp={stopRecording}>🎤 Giữ để nói</button>
        <button onClick={runCode}>Chạy thử</button>
        <button onClick={doneStage}>Em xong phần này</button>
        <button onClick={endSession}>Kết thúc</button>
      </div>

      <h3>Code</h3>
      <textarea value={code} onChange={(e) => sendCode(e.target.value)} rows={12} style={{ width: "100%", fontFamily: "monospace" }} />

      <h3>Whiteboard</h3>
      <div style={{ height: 420, border: "1px solid #ccc" }}>
        <Excalidraw onChange={handleWhiteboardChange} />
      </div>
      <button onClick={sendBoardDone}>Xong sơ đồ</button>

      <h3>Transcript</h3>
      <div style={{ background: "#f5f5f5", padding: 8, minHeight: 120, whiteSpace: "pre-wrap" }}>{log.join("\n")}</div>

      {evaluation ? (
        <>
          <h3>Nhận xét cuối buổi</h3>
          <pre>{JSON.stringify(evaluation, null, 2)}</pre>
        </>
      ) : null}
    </div>
  );
}
