// src/interview/persistence/problem-repository.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ProblemRepository, ProblemNotFoundError } from "./problem-repository";

function localDdb(): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
}

describe("ProblemRepository (DynamoDB Local)", () => {
  const repo = new ProblemRepository(localDdb(), "Problems");

  it("getProblem trả về đúng item METADATA kèm hidden_constraints", async () => {
    const problem = await repo.getProblem("prob_1");
    expect(problem.title).toBe("Two Sum");
    expect(problem.hidden_constraints?.length).toBeGreaterThan(0);
    expect(problem.test_cases.filter((t) => !t.is_sample).length).toBeGreaterThanOrEqual(5);
  });

  it("getProblem ném ProblemNotFoundError khi id không tồn tại", async () => {
    await expect(repo.getProblem("prob_does_not_exist")).rejects.toBeInstanceOf(ProblemNotFoundError);
  });

  it("getRandomProblemId trả về 1 trong các id đã seed", async () => {
    const id = await repo.getRandomProblemId();
    expect(["prob_1", "prob_2"]).toContain(id);
  });
});
