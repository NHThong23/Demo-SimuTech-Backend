import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { getInterviewRuntime } from "./src/interview/runtime";
import { attachWsGateway } from "./src/interview/ws/ws-gateway";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/ws/session/")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const runtime = getInterviewRuntime();
        attachWsGateway(ws, url, {
          sessionManager: runtime.sessionManager,
          interviewRepository: runtime.interviewRepository,
          metrics: runtime.metrics,
          clock: runtime.clock,
          agents: {
            llm: runtime.agents.llm,
            stt: runtime.agents.stt,
            tts: runtime.agents.tts,
            codeExecutor: runtime.agents.codeExecutor,
          },
        });
      });
    } else if (dev) {
      app.getUpgradeHandler()(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> Server ready on http://localhost:${port} (WS tại /ws/session/:id)`);
  });
});
