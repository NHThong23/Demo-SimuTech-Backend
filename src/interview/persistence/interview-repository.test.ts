// src/interview/persistence/interview-repository.test.ts
import { describe, it, expect } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { InterviewRepository } from "./interview-repository";
import type { SessionMetaItem, Turn } from "../domain/types";

function localDdb(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
}

function meta(sessionId: string): SessionMetaItem {
  return {
    session_id: sessionId,
    sk: "META",
    problem_id: "prob_1",
    language: "python",
    token_hash: "hash123",
    status: "active",
    current_stage: 1,
    started_at: new Date().toISOString(),
    model_versions: { qwen: "fake", stt: "fake", tts: "fake" },
  };
}

function turn(id: string, createdAt: string): Turn {
  return {
    turnId: id,
    role: "ai",
    stage: 1,
    trigger: "stage_enter",
    text: `turn ${id}`,
    action: "speak",
    interrupted: false,
    createdAt,
  };
}

describe("InterviewRepository (DynamoDB Local)", () => {
  const repo = new InterviewRepository(localDdb(), "InterviewSessions");

  it("createMeta rồi getSessionReport trả về đúng meta", async () => {
    const sessionId = `ses_test_${Date.now()}_meta`;
    await repo.createMeta(meta(sessionId));
    const report = await repo.getSessionReport(sessionId);
    expect(report.meta?.problem_id).toBe("prob_1");
    expect(report.meta?.status).toBe("active");
  });

  it("updateMeta cập nhật status và current_stage", async () => {
    const sessionId = `ses_test_${Date.now()}_update`;
    await repo.createMeta(meta(sessionId));
    await repo.updateMeta(sessionId, { status: "completed", current_stage: 6 });
    const report = await repo.getSessionReport(sessionId);
    expect(report.meta?.status).toBe("completed");
    expect(report.meta?.current_stage).toBe(6);
  });

  it("putTurn nhiều lần trả về đúng thứ tự thời gian trong getSessionReport", async () => {
    const sessionId = `ses_test_${Date.now()}_turns`;
    await repo.createMeta(meta(sessionId));
    await repo.putTurn(sessionId, turn("t1", "2026-09-14T10:00:00.000Z"));
    await repo.putTurn(sessionId, turn("t2", "2026-09-14T10:00:05.000Z"));
    const report = await repo.getSessionReport(sessionId);
    expect(report.turns.map((t) => t.turnId)).toEqual(["t1", "t2"]);
  });

  it("putRun, putBoard, putEvaluation đều đọc lại được qua getSessionReport", async () => {
    const sessionId = `ses_test_${Date.now()}_extras`;
    await repo.createMeta(meta(sessionId));
    await repo.putCodeSnapshot(sessionId, 3, "print(1)", "python");
    await repo.putRun(sessionId, 3, { runId: "r1", mode: "sample", status: "OK", tests: [] });
    await repo.putBoard(sessionId, 5, { nodes: [], edges: [] });
    await repo.putEvaluation(sessionId, {
      pillars: null,
      objective: {
        hidden_tests_passed: 0, hidden_tests_total: 0, constraints_clarified: 0, constraints_total: 0,
        hints_given: 0, code_runs: 1, interruptions: 0, stage_durations_sec: {}, forced_transitions: [],
      },
      summary: "test",
    });
    const report = await repo.getSessionReport(sessionId);
    expect(report.codeRuns[0].runId).toBe("r1");
    expect(report.boards[0].stage).toBe(5);
    expect(report.evaluation?.summary).toBe("test");
  });
});
