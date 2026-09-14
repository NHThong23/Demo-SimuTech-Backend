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
    let url: URL;
    try {
      url = new URL(req.url ?? "", `http://${req.headers.host}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname.startsWith("/ws/session/")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        try {
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
        } catch (err) {
          // A synchronous throw here (e.g. getInterviewRuntime() failing to construct its
          // DynamoDB client on first call) is an uncaught exception in this callback context,
          // not a failed connection — left unguarded it crashes the whole process. Close the
          // socket instead and keep the server alive.
          console.error("Failed to attach WS gateway:", err);
          ws.close(1011, "Internal error");
        }
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
}).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
