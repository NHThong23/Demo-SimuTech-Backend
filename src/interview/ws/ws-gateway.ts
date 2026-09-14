import { randomUUID, createHash } from "node:crypto";
import type { WebSocket } from "ws";
import type { Session } from "../session/session";
import type { SessionManager } from "../session/session-manager";
import type { Clock } from "../session/clock";
import type { StageMachineEvent } from "../session/stage-machine";
import { EventRouter, type TriggerPayload } from "../router/event-router";
import { TurnRunner, type TurnOutputSink } from "../turn/turn-runner";
import { SpeechBuffer } from "../turn/speech-buffer";
import { runTestSuite } from "../agents/code-runner";
import type { LlmAgent, SttAgent, TtsAgent, CodeExecutor } from "../agents/types";
import type { InterviewRepository } from "../persistence/interview-repository";
import type { MetricsCollector } from "../metrics/metrics";
import { buildEvaluation } from "../evaluation/evaluation";
import { decodeClientMessage, encodeServerMessage, type ClientMessage, type ServerMessage } from "../protocol/messages";
import type { CodeRunResult, TriggerType } from "../domain/types";
import { getStageConfig } from "../config/stages";

export interface WsGatewayDeps {
  sessionManager: SessionManager;
  interviewRepository: InterviewRepository;
  metrics: MetricsCollector;
  clock: Clock;
  agents: { llm: LlmAgent; stt: SttAgent; tts: TtsAgent; codeExecutor: CodeExecutor };
}

interface TimerHolder {
  current: unknown;
}

const connections = new Map<string, { ws: WebSocket; eventRouter: EventRouter; timerHolder: TimerHolder; clock: Clock }>();

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function attachWsGateway(ws: WebSocket, url: URL, deps: WsGatewayDeps): void {
  const match = url.pathname.match(/^\/ws\/session\/([^/]+)$/);
  const sessionIdParam = match?.[1];
  const token = url.searchParams.get("token");
  if (!sessionIdParam || !token) {
    ws.close(4404, "Session not found");
    return;
  }
  const sessionId: string = sessionIdParam;
  const foundSession = deps.sessionManager.get(sessionId);
  if (!foundSession) {
    ws.close(4404, "Session not found");
    return;
  }
  if (foundSession.tokenHash !== hashToken(token)) {
    ws.close(4401, "Invalid token");
    return;
  }
  // Re-bound with a non-optional type: TypeScript's control-flow narrowing from the guards
  // above does not persist into the many nested closures below (sink handlers, runTurn,
  // applyStageTransition, handleClientMessage, ...), so `session`/`sessionId` must have a
  // non-union static type for those closures to type-check without `!` assertions everywhere.
  const session: Session = foundSession;

  const existing = connections.get(sessionId);
  if (existing) {
    existing.eventRouter.dispose();
    existing.clock.clearTimeout(existing.timerHolder.current);
    existing.ws.close(4409, "Replaced by new connection");
    connections.delete(sessionId);
  }

  const send = (msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(encodeServerMessage(msg));
  };

  const sendState = (): void => {
    const cfg = getStageConfig(session.currentStage);
    send({
      type: "session.state",
      data: {
        stage: session.currentStage,
        stageName: cfg.name,
        stageElapsedSec: session.stageElapsedSec,
        stageMinSec: cfg.minSec,
        stageMaxSec: cfg.maxSec,
        silenceThresholdSec: cfg.silenceThresholdSec,
        aiStatus: session.aiStatus,
        status: session.status,
      },
    });
  };

  let busy = false;
  const timerHolder: TimerHolder = { current: null };
  // The id of the utterance currently being spoken (set as soon as TurnRunner tells us it has
  // started, cleared when it finishes). onInterrupt reads this directly instead of guessing from
  // session.turns.at(-1) — at the moment onInterrupt runs (synchronously, from the client's
  // speech.start message) the in-flight turn has NOT been recorded into session.turns yet (that
  // only happens after `await turnRunner.run(...)` resolves back in runTurn), so `.at(-1)` would
  // either be undefined (first turn ever) or point at a stale, unrelated, already-finished turn.
  let inFlightTurnId: string | null = null;

  const sink: TurnOutputSink = {
    onAiReply: (id, text) => send({ type: "ai.reply", data: { utteranceId: id, text } }),
    onAiSpeechStart: (id) => {
      inFlightTurnId = id;
      session.aiStatus = "speaking";
      send({ type: "ai.speech.start", data: { utteranceId: id, sampleRate: 24000, format: "pcm16" } });
    },
    onAiSpeechChunk: (_id, chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    },
    onAiSpeechEnd: (id) => {
      inFlightTurnId = null;
      session.aiStatus = "idle";
      send({ type: "ai.speech.end", data: { utteranceId: id } });
      eventRouter.handleAiFinishedSpeaking();
    },
  };

  const turnRunner = new TurnRunner({ llm: deps.agents.llm, tts: deps.agents.tts, sink });
  const speechBuffer = new SpeechBuffer(deps.agents.stt);

  async function ensureHiddenTestsRunIfNeeded(): Promise<void> {
    const hiddenCases = session.problem.test_cases.filter((t) => !t.is_sample);
    if (hiddenCases.length === 0 || session.hiddenTestsTotal > 0) return;
    const results = await runTestSuite(deps.agents.codeExecutor, session.language, session.latestCode, hiddenCases, new AbortController().signal);
    session.updateHiddenTestProgress(results.filter((t) => t.passed).length, hiddenCases.length);
  }

  /** Persist + notify side effects of a transition that has ALREADY been applied via
   * `session.attemptTransition(...)`. Shared by `applyStageTransition` and the EventRouter's
   * `canDoneStage`, which both need to run this after computing (and applying) a transition
   * result themselves — never call `session.attemptTransition` again here, that would apply the
   * same transition a second time. */
  function afterTransitionApplied(): void {
    void deps.interviewRepository
      .updateMeta(session.sessionId, { current_stage: session.currentStage, status: session.status })
      .catch(() => deps.metrics.recordError("persistence"));
    if (session.status === "completed") {
      void finishSession();
    } else {
      sendState();
      eventRouter.onStageEntered();
    }
  }

  function applyStageTransition(event: StageMachineEvent): void {
    const result = session.attemptTransition(event);
    if (!result.transitioned) return;
    afterTransitionApplied();
  }

  async function finishSession(): Promise<void> {
    await ensureHiddenTestsRunIfNeeded();
    const notes = session.turns.filter((t) => t.note).map((t) => t.note as string);
    const evaluation = await buildEvaluation(deps.agents.llm, {
      problem: session.problem,
      revealedConstraints: [...session.revealedConstraints],
      coveredTopics: [...session.coveredTopics],
      hintsGiven: session.hintsGiven,
      codeRunsCount: session.codeRuns.length,
      interruptions: session.interruptions,
      stageDurationsSec: session.stageDurationsSec,
      forcedTransitions: session.forcedTransitions,
      hiddenTestsPassed: session.hiddenTestsPassed,
      hiddenTestsTotal: session.hiddenTestsTotal,
      recentTurns: session.recentTurns,
      allNotes: notes,
      latestCode: session.latestCode,
    });
    await deps.interviewRepository
      .putEvaluation(session.sessionId, evaluation)
      .catch(() => deps.metrics.recordError("persistence"));
    await deps.interviewRepository
      .updateMeta(session.sessionId, { status: "completed", ended_at: new Date().toISOString() })
      .catch(() => deps.metrics.recordError("persistence"));
    send({ type: "session.evaluation", data: evaluation });
    sendState();
    cleanup();
  }

  async function runTurn(trigger: TriggerType, payload: TriggerPayload): Promise<void> {
    busy = true;
    session.aiStatus = "thinking";
    inFlightTurnId = null;
    const controller = new AbortController();
    session.currentTurnController = controller;
    const startedAt = deps.clock.now();
    try {
      const result = await turnRunner.run({ session: session.toSnapshot(), trigger, payload, signal: controller.signal });
      if (controller.signal.aborted) {
        // The turn was cut short mid-speech (barge-in). TurnRunner still returns a fully-formed
        // Turn (the LLM call had already completed; only the TTS loop was interrupted) — record
        // it and mark it interrupted so it isn't silently dropped from history/persistence, and
        // so `session.interruptions` (used in the final evaluation) reflects it.
        session.recordTurn(result.turn);
        session.markInterrupted(result.turn.turnId);
        return;
      }
      session.recordTurn(result.turn);
      session.applyLlmReveal({ revealed_constraints: result.revealedConstraints, covered_topics: result.coveredTopics });
      deps.metrics.recordTurnLatency({
        llmMs: result.turn.latencyMs?.llm,
        ttsFirstAudioMs: result.turn.latencyMs?.ttsFirstAudio,
        ttsTotalMs: result.turn.latencyMs?.ttsTotal,
        totalMs: deps.clock.now() - startedAt,
      });
      deps.metrics.recordJsonOutcome(!result.turn.error);
      if (result.turn.error) deps.metrics.recordError("llm");
      void deps.interviewRepository.putTurn(session.sessionId, result.turn).catch(() => deps.metrics.recordError("persistence"));
      if (result.stageAction === "next_stage" || result.stageAction === "end") {
        applyStageTransition({ type: "llm_next_stage" });
      }
    } finally {
      if (session.aiStatus === "thinking") session.aiStatus = "idle";
      session.currentTurnController = null;
      busy = false;
      const pending = eventRouter.flushPending();
      if (pending.length > 0) {
        const merged = pending[pending.length - 1];
        void runTurn(merged.kind as TriggerType, merged);
      }
    }
  }

  const eventRouter = new EventRouter({
    clock: deps.clock,
    getSilenceThresholdSec: () => getStageConfig(session.currentStage).silenceThresholdSec,
    getStageElapsedSec: () => session.stageElapsedSec,
    getStageMaxSec: () => getStageConfig(session.currentStage).maxSec,
    isBusy: () => busy,
    onTrigger: (trigger, payload) => void runTurn(trigger, payload),
    onInterrupt: () => {
      session.currentTurnController?.abort();
      // Use the id of the utterance actually being spoken right now (captured by the sink as
      // soon as TurnRunner started it), not session.turns.at(-1): at this point (synchronously,
      // from the client's speech.start handler) the in-flight turn has not been recorded into
      // session.turns yet — that happens later, after `turnRunner.run(...)` resolves back in
      // runTurn — so `.at(-1)` would point at a stale/unrelated turn or be undefined.
      send({ type: "ai.speech.cancelled", data: { utteranceId: inFlightTurnId ?? "" } });
      session.aiStatus = "listening";
    },
    onStagePrecondition: (message) => send({ type: "error", data: { code: "STAGE_PRECONDITION", message, retryable: false } }),
    canDoneStage: () => {
      const result = session.attemptTransition({ type: "stage_done_button" });
      if (result.rejected) return { ok: false, message: result.rejected.message };
      if (result.transitioned) afterTransitionApplied();
      return { ok: true };
    },
  });

  function scheduleForcedTick(): void {
    // Write into the shared holder, not a fresh local variable — the value stored in
    // `connections` is `timerHolder` itself (by reference), so every reschedule (this function
    // calls itself again on each tick) keeps `connections.get(sessionId).timerHolder.current`
    // pointing at the CURRENT live timer handle. Storing a plain `unknown` snapshot in the map
    // (as opposed to this holder) would freeze it at whatever the value was at `connections.set`
    // time — which is `null`, since this function hasn't run yet at that point — making a later
    // reconnect's `clearTimeout(existing.timerHolder.current)` a permanent no-op and leaking a
    // real 5s-repeating timer for the lifetime of the process.
    timerHolder.current = deps.clock.setTimeout(() => {
      applyStageTransition({ type: "tick" });
      scheduleForcedTick();
    }, 5000);
  }

  function cleanup(): void {
    deps.clock.clearTimeout(timerHolder.current);
    eventRouter.dispose();
    if (connections.get(sessionId)?.ws === ws) connections.delete(sessionId);
  }

  connections.set(sessionId, { ws, eventRouter, timerHolder, clock: deps.clock });

  sendState();
  eventRouter.onStageEntered();
  scheduleForcedTick();

  ws.on("message", (data: Buffer, isBinary: boolean) => {
    if (isBinary) {
      speechBuffer.addChunk(data);
      return;
    }
    const text = data.toString("utf8");
    if (text.length > 1_000_000) {
      send({ type: "error", data: { code: "PAYLOAD_TOO_LARGE", message: "Message too large", retryable: false } });
      return;
    }
    const decoded = decodeClientMessage(text);
    if (!decoded.ok) {
      send({ type: "error", data: { code: "INVALID_MESSAGE", message: decoded.error, retryable: false } });
      return;
    }
    void handleClientMessage(decoded.value);
  });

  ws.on("close", () => {
    if (connections.get(sessionId)?.ws === ws) cleanup();
  });

  async function handleClientMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "speech.start":
        session.aiStatus = "listening";
        eventRouter.handleSpeechStart();
        return;
      case "speech.pause":
        await speechBuffer.pause(new AbortController().signal);
        return;
      case "speech.end": {
        const { transcript, sttMs } = await speechBuffer.end(new AbortController().signal);
        if (transcript) send({ type: "transcript.user", data: { utteranceId: randomUUID(), text: transcript } });
        deps.metrics.recordTurnLatency({ sttMs });
        eventRouter.handleSpeechEnd(transcript);
        return;
      }
      case "editor.update":
        session.latestCode = msg.data.code;
        eventRouter.handleEditorUpdate();
        return;
      case "code.run": {
        const customInput = msg.data?.customInput;
        const runId = randomUUID();
        let result: CodeRunResult;
        if (customInput !== undefined) {
          const single = await deps.agents.codeExecutor.run({
            language: session.language, code: session.latestCode, stdin: customInput, signal: new AbortController().signal,
          });
          result = { runId, mode: "custom", status: single.status, output: { stdout: single.stdout, stderr: single.stderr, timeMs: single.timeMs } };
        } else {
          const sampleCases = session.problem.test_cases.filter((t) => t.is_sample);
          const tests = await runTestSuite(deps.agents.codeExecutor, session.language, session.latestCode, sampleCases, new AbortController().signal);
          result = { runId, mode: "sample", status: "OK", tests };
        }
        session.recordCodeRun(result);
        send({ type: "code.result", data: result });
        void deps.interviewRepository
          .putCodeSnapshot(session.sessionId, session.currentStage, session.latestCode, session.language)
          .catch(() => deps.metrics.recordError("persistence"));
        void deps.interviewRepository
          .putRun(session.sessionId, session.currentStage, result)
          .catch(() => deps.metrics.recordError("persistence"));

        if (session.currentStage === 4) {
          const hiddenCases = session.problem.test_cases.filter((t) => !t.is_sample);
          if (hiddenCases.length > 0) {
            const hiddenResults = await runTestSuite(deps.agents.codeExecutor, session.language, session.latestCode, hiddenCases, new AbortController().signal);
            const passed = hiddenResults.filter((t) => t.passed).length;
            session.updateHiddenTestProgress(passed, hiddenCases.length);
            if (passed === hiddenCases.length) applyStageTransition({ type: "hidden_tests_passed" });
          }
        }
        eventRouter.handleCodeRunResult(result);
        return;
      }
      case "whiteboard.update":
        session.latestBoardByStage[session.currentStage] = msg.data;
        eventRouter.handleWhiteboardUpdate();
        return;
      case "whiteboard.done": {
        const board = session.latestBoardByStage[session.currentStage];
        if (board) {
          void deps.interviewRepository
            .putBoard(session.sessionId, session.currentStage, board)
            .catch(() => deps.metrics.recordError("persistence"));
        }
        eventRouter.handleWhiteboardDone();
        return;
      }
      case "stage.done":
        eventRouter.handleStageDone();
        return;
      case "session.end":
        applyStageTransition({ type: "stage_done_button" });
        return;
    }
  }
}
