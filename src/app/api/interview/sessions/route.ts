import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getInterviewRuntime } from "@/interview/runtime";
import { hashToken } from "@/interview/ws/ws-gateway";
import { TooManySessionsError } from "@/interview/session/session-manager";
import { ProblemNotFoundError } from "@/interview/persistence/problem-repository";
import { STAGE_CONFIG } from "@/interview/config/stages";

const CreateSessionRequestSchema = z.object({
  problemId: z.string().optional(),
  language: z.enum(["python", "javascript", "cpp"]),
  userId: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "INVALID_BODY", message: "Body phải là JSON hợp lệ" }, { status: 400 });
  }
  const parsed = CreateSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_BODY", message: parsed.error.message }, { status: 400 });
  }

  const runtime = getInterviewRuntime();
  const health = await runtime.agents.modelHealth.check();
  if (!health.qwen || !health.stt || !health.tts) {
    return Response.json({ code: "MODELS_NOT_READY", details: health }, { status: 503 });
  }

  const problemId = parsed.data.problemId ?? (await runtime.problemRepository.getRandomProblemId());
  let problem;
  try {
    problem = await runtime.problemRepository.getProblem(problemId);
  } catch (err) {
    if (err instanceof ProblemNotFoundError) {
      return Response.json({ code: "PROBLEM_NOT_FOUND", message: err.message }, { status: 404 });
    }
    throw err;
  }

  const sessionId = `ses_${randomUUID()}`;
  const token = randomBytes(24).toString("hex");

  let session;
  try {
    session = runtime.sessionManager.create({
      sessionId,
      tokenHash: hashToken(token),
      problem,
      language: parsed.data.language,
      userId: parsed.data.userId,
      clock: runtime.clock,
    });
  } catch (err) {
    if (err instanceof TooManySessionsError) {
      return Response.json({ code: "TOO_MANY_SESSIONS", message: "Đang có quá nhiều phiên chạy đồng thời" }, { status: 429 });
    }
    throw err;
  }

  try {
    await runtime.interviewRepository.createMeta({
      session_id: sessionId,
      sk: "META",
      problem_id: problem.problem_id,
      language: session.language,
      user_id: parsed.data.userId,
      token_hash: session.tokenHash,
      status: "active",
      current_stage: 1,
      started_at: new Date().toISOString(),
      model_versions: { qwen: "fake", stt: "fake", tts: "fake" },
    });
  } catch (err) {
    // createMeta runs AFTER sessionManager.create(...) already registered the session as
    // "active" — if persistence fails here, the session must not be left stranded occupying a
    // concurrency slot forever. Release it before returning the error.
    runtime.sessionManager.remove(sessionId);
    runtime.metrics.recordError("persistence");
    return Response.json({ code: "PERSISTENCE_FAILED", message: "Không thể lưu phiên phỏng vấn" }, { status: 500 });
  }

  return Response.json(
    {
      sessionId,
      token,
      problem: {
        problemId: problem.problem_id,
        title: problem.title,
        description: problem.description,
        starterCode: problem.starter_code,
        sampleTests: problem.test_cases
          .filter((t) => t.is_sample)
          .map((t) => ({ id: t.id, input: t.input, output: t.output })),
      },
      stages: STAGE_CONFIG.map((s) => ({ index: s.index, name: s.name, minSec: s.minSec, maxSec: s.maxSec })),
    },
    { status: 201 },
  );
}
