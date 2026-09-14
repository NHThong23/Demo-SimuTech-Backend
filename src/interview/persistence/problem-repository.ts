import { GetCommand, ScanCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Problem } from "../domain/types";

export class ProblemNotFoundError extends Error {
  constructor(problemId: string) {
    super(`Problem not found: ${problemId}`);
    this.name = "ProblemNotFoundError";
  }
}

export class ProblemRepository {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private tableName: string = process.env.DDB_PROBLEMS_TABLE ?? "Problems",
  ) {}

  async getProblem(problemId: string): Promise<Problem> {
    const res = await this.ddb.send(
      new GetCommand({ TableName: this.tableName, Key: { problem_id: problemId, sk: "METADATA" } }),
    );
    if (!res.Item) throw new ProblemNotFoundError(problemId);
    return res.Item as Problem;
  }

  async getRandomProblemId(): Promise<string> {
    const res = await this.ddb.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "sk = :sk",
        ExpressionAttributeValues: { ":sk": "METADATA" },
        ProjectionExpression: "problem_id",
      }),
    );
    const items = res.Items ?? [];
    if (items.length === 0) throw new Error("No problems found in table");
    return items[Math.floor(Math.random() * items.length)].problem_id as string;
  }
}
