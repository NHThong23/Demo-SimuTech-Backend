import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '@/lib/db/dynamodb';
import {
  InterviewSession,
  InterviewMessage,
  CodeSnapshot,
  AIEvaluation,
  InterviewStatus,
  DYNAMODB_TABLES,
  DYNAMODB_INDEXES,
  INTERVIEW_SK,
  MESSAGE_SK_PREFIX,
  CODE_SNAPSHOT_SK_PREFIX,
  EVALUATION_SK_PREFIX,
} from '@/entities';

export class InterviewRepository {
  private tableName = DYNAMODB_TABLES.INTERVIEWS;

  async createSession(session: InterviewSession): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: session,
    });
    await docClient.send(command);
  }

  async getSession(interviewId: string): Promise<InterviewSession | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        interview_id: interviewId,
        sk: INTERVIEW_SK,
      },
    });

    const response = await docClient.send(command);
    return (response.Item as InterviewSession) || null;
  }

  async updateSessionStatus(
    interviewId: string,
    status: InterviewStatus,
    overallScore?: number,
    completedAt?: string
  ): Promise<void> {
    const expressions: string[] = ['#s = :status'];
    const names: Record<string, string> = { '#s': 'status' };
    const values: Record<string, any> = { ':status': status };

    if (overallScore !== undefined) {
      expressions.push('overall_score = :score');
      values[':score'] = overallScore;
    }
    if (completedAt) {
      expressions.push('completed_at = :completed_at');
      values[':completed_at'] = completedAt;
    }

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        interview_id: interviewId,
        sk: INTERVIEW_SK,
      },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    });

    await docClient.send(command);
  }

  async addMessage(message: InterviewMessage): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: message,
    });
    await docClient.send(command);
  }

  async getMessages(interviewId: string): Promise<InterviewMessage[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'interview_id = :iid and begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':iid': interviewId,
        ':prefix': MESSAGE_SK_PREFIX,
      },
      ScanIndexForward: true, // chronological order
    });

    const response = await docClient.send(command);
    return (response.Items as InterviewMessage[]) || [];
  }

  async saveCodeSnapshot(snapshot: CodeSnapshot): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: snapshot,
    });
    await docClient.send(command);
  }

  async getCodeSnapshots(interviewId: string): Promise<CodeSnapshot[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'interview_id = :iid and begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':iid': interviewId,
        ':prefix': CODE_SNAPSHOT_SK_PREFIX,
      },
      ScanIndexForward: false, // newest first
    });

    const response = await docClient.send(command);
    return (response.Items as CodeSnapshot[]) || [];
  }

  async saveEvaluation(evaluation: AIEvaluation): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: evaluation,
    });
    await docClient.send(command);
  }

  async getEvaluation(interviewId: string): Promise<AIEvaluation | null> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'interview_id = :iid and begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':iid': interviewId,
        ':prefix': EVALUATION_SK_PREFIX,
      },
      Limit: 1,
    });

    const response = await docClient.send(command);
    return (response.Items?.[0] as AIEvaluation) || null;
  }

  async listByUser(userId: string, limit = 20): Promise<InterviewSession[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: DYNAMODB_INDEXES.USER_INTERVIEWS,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: {
        ':uid': String(userId),
      },
      ScanIndexForward: false, // latest first
      Limit: limit,
    });

    const response = await docClient.send(command);
    return (response.Items as InterviewSession[]) || [];
  }

  /**
   * Single-Table Design Power: Fetch all items for an interview (session, messages, snapshots, evaluation)
   * in a single DynamoDB query!
   */
  async getFullInterviewContext(interviewId: string) {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'interview_id = :iid',
      ExpressionAttributeValues: {
        ':iid': interviewId,
      },
    });

    const response = await docClient.send(command);
    const items = response.Items || [];

    let session: InterviewSession | null = null;
    const messages: InterviewMessage[] = [];
    const snapshots: CodeSnapshot[] = [];
    let evaluation: AIEvaluation | null = null;

    for (const item of items) {
      if (item.entity_type === 'INTERVIEW') {
        session = item as InterviewSession;
      } else if (item.entity_type === 'MESSAGE') {
        messages.push(item as InterviewMessage);
      } else if (item.entity_type === 'CODE_SNAPSHOT') {
        snapshots.push(item as CodeSnapshot);
      } else if (item.entity_type === 'EVALUATION') {
        evaluation = item as AIEvaluation;
      }
    }

    return { session, messages, snapshots, evaluation };
  }
}

export const interviewRepository = new InterviewRepository();
