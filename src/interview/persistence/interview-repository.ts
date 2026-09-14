import { PutCommand, QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type {
  CodeRunResult, EvaluationResult, Language, SessionMetaItem, Stage, Turn, WhiteboardState,
} from "../domain/types";

export interface SessionReport {
  meta: SessionMetaItem | null;
  turns: Turn[];
  codeRuns: CodeRunResult[];
  boards: Array<{ stage: Stage; board: WhiteboardState }>;
  evaluation: EvaluationResult | null;
}

export class InterviewRepository {
  constructor(
    private ddb: DynamoDBDocumentClient,
    private tableName: string = process.env.DDB_SESSIONS_TABLE ?? "InterviewSessions",
  ) {}

  async createMeta(meta: SessionMetaItem): Promise<void> {
    await this.ddb.send(new PutCommand({ TableName: this.tableName, Item: meta }));
  }

  async updateMeta(sessionId: string, patch: Partial<Omit<SessionMetaItem, "session_id" | "sk">>): Promise<void> {
    const entries = Object.entries(patch);
    if (entries.length === 0) return;
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets = entries.map(([key, value]) => {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      return `#${key} = :${key}`;
    });
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { session_id: sessionId, sk: "META" },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async putTurn(sessionId: string, turn: Turn): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `TURN#${turn.createdAt}#${turn.turnId}`, ...turn },
      }),
    );
  }

  async putCodeSnapshot(sessionId: string, stage: Stage, code: string, language: Language): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `CODE#${new Date().toISOString()}`, stage, code, language },
      }),
    );
  }

  async putRun(sessionId: string, stage: Stage, run: CodeRunResult): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `RUN#${new Date().toISOString()}`, stage, ...run },
      }),
    );
  }

  async putBoard(sessionId: string, stage: Stage, board: WhiteboardState): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { session_id: sessionId, sk: `BOARD#${stage}`, stage, ...board },
      }),
    );
  }

  async putEvaluation(sessionId: string, evaluation: EvaluationResult): Promise<void> {
    await this.ddb.send(
      new PutCommand({ TableName: this.tableName, Item: { session_id: sessionId, sk: "EVAL", ...evaluation } }),
    );
  }

  async getSessionReport(sessionId: string): Promise<SessionReport> {
    const res = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "session_id = :sid",
        ExpressionAttributeValues: { ":sid": sessionId },
      }),
    );
    const items = res.Items ?? [];
    const meta = (items.find((i) => i.sk === "META") as SessionMetaItem | undefined) ?? null;
    const turns = items.filter((i) => (i.sk as string).startsWith("TURN#")) as unknown as Turn[];
    const codeRuns = items.filter((i) => (i.sk as string).startsWith("RUN#")) as unknown as CodeRunResult[];
    const boards = items
      .filter((i) => (i.sk as string).startsWith("BOARD#"))
      .map((i) => ({ stage: i.stage as Stage, board: { nodes: i.nodes, edges: i.edges } as WhiteboardState }));
    const evalItem = items.find((i) => i.sk === "EVAL");
    const evaluation = evalItem ? (evalItem as unknown as EvaluationResult) : null;
    return { meta, turns, codeRuns, boards, evaluation };
  }
}
