import WebSocket from "ws";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const WS_BASE = BASE_URL.replace(/^http/, "ws");

interface ServerMsg { type: string; data?: any; }

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), ...args);
}

async function createSession(): Promise<{ sessionId: string; token: string; problem: any }> {
  const res = await fetch(`${BASE_URL}/api/interview/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language: "python" }),
  });
  if (!res.ok) throw new Error(`Tạo phiên thất bại: ${res.status} ${await res.text()}`);
  return res.json();
}

function waitForMessage(ws: WebSocket, predicate: (msg: ServerMsg) => boolean, timeoutMs = 15000): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Hết thời gian chờ message")), timeoutMs);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { sessionId, token, problem } = await createSession();
  log("Đã tạo phiên", sessionId, "— đề:", problem.title);

  const ws = new WebSocket(`${WS_BASE}/ws/session/${sessionId}?token=${token}`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  log("Đã kết nối WebSocket");

  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    const msg = JSON.parse(data.toString()) as ServerMsg;
    if (msg.type === "session.state") {
      log(`[state] chặng ${msg.data.stage} (${msg.data.stageName}) — AI: ${msg.data.aiStatus}`);
    } else if (msg.type === "ai.reply") {
      log(`[AI nói] ${msg.data.text}`);
    } else if (msg.type === "error") {
      log(`[LỖI] ${msg.data.code}: ${msg.data.message}`);
    }
  });

  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 1);

  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 2);
  log("Đã qua chặng 2");

  ws.send(JSON.stringify({ type: "whiteboard.update", data: { nodes: [{ id: "n1", label: "hash map", x: 0, y: 0 }], edges: [] } }));
  ws.send(JSON.stringify({ type: "whiteboard.done" }));
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 3);
  log("Đã qua chặng 3");

  ws.send(JSON.stringify({ type: "editor.update", data: { code: problem.starterCode, language: "python" } }));
  ws.send(JSON.stringify({ type: "code.run" }));
  await waitForMessage(ws, (m) => m.type === "code.result");
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 4);
  log("Đã qua chặng 4");

  ws.send(JSON.stringify({ type: "code.run" }));
  await waitForMessage(ws, (m) => m.type === "code.result");
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 5);
  log("Đã qua chặng 5");

  ws.send(JSON.stringify({ type: "whiteboard.update", data: { nodes: [{ id: "n1", label: "shard theo hash", x: 0, y: 0 }], edges: [] } }));
  ws.send(JSON.stringify({ type: "whiteboard.done" }));
  ws.send(JSON.stringify({ type: "stage.done" }));
  await waitForMessage(ws, (m) => m.type === "session.state" && m.data.stage === 6);
  log("Đã qua chặng 6");

  // Gửi 1 đoạn audio rỗng để xác nhận đường audio nhị phân không làm crash server.
  ws.send(JSON.stringify({ type: "speech.start" }));
  ws.send(new Int16Array(1600).buffer);
  ws.send(JSON.stringify({ type: "speech.end" }));
  await new Promise((r) => setTimeout(r, 500));

  ws.send(JSON.stringify({ type: "session.end" }));
  const evalMsg = await waitForMessage(ws, (m) => m.type === "session.evaluation");
  log("Nhận được bản nhận xét cuối buổi:");
  console.log(JSON.stringify(evalMsg.data, null, 2));

  const reportRes = await fetch(`${BASE_URL}/api/interview/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const report = await reportRes.json();
  log("Số liệu độ trễ (metrics, gộp toàn server):", JSON.stringify(report.metrics));

  log(`Hoàn tất mô phỏng sau ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
