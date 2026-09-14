import { getInterviewRuntime } from "@/interview/runtime";
import { hashToken } from "@/interview/ws/ws-gateway";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const runtime = getInterviewRuntime();

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) {
    return Response.json({ code: "UNAUTHORIZED", message: "Thiếu Authorization: Bearer <token>" }, { status: 401 });
  }

  const report = await runtime.interviewRepository.getSessionReport(id);
  const liveSession = runtime.sessionManager.get(id);
  const expectedHash = liveSession?.tokenHash ?? report.meta?.token_hash;
  if (!expectedHash) {
    return Response.json({ code: "NOT_FOUND", message: "Không tìm thấy phiên" }, { status: 404 });
  }
  if (hashToken(token) !== expectedHash) {
    return Response.json({ code: "UNAUTHORIZED", message: "Token không đúng" }, { status: 401 });
  }

  return Response.json({
    meta: report.meta,
    turns: report.turns,
    runs: report.codeRuns,
    boards: report.boards,
    evaluation: report.evaluation,
    metrics: runtime.metrics.summary(),
  });
}
