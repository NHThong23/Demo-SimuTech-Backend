import { Session, type SessionOptions } from "./session";

export interface SessionManagerOptions { maxConcurrent: number; }

export class TooManySessionsError extends Error {
  constructor() {
    super("TOO_MANY_SESSIONS");
    this.name = "TooManySessionsError";
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(private opts: SessionManagerOptions) {}

  create(opts: SessionOptions): Session {
    const activeCount = [...this.sessions.values()].filter((s) => s.status === "active").length;
    if (activeCount >= this.opts.maxConcurrent) throw new TooManySessionsError();
    const session = new Session(opts);
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
