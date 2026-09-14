import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '@/lib/db/dynamodb';
import {
  Problem,
  Submission,
  ProblemDifficulty,
  DYNAMODB_TABLES,
  DYNAMODB_INDEXES,
  PROBLEM_SK,
  SUBMISSION_SK_PREFIX,
} from '@/entities';

export class ProblemRepository {
  private tableName = DYNAMODB_TABLES.PROBLEMS;

  async findById(problemId: string): Promise<Problem | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        problem_id: problemId,
        sk: PROBLEM_SK,
      },
    });

    const response = await docClient.send(command);
    return (response.Item as Problem) || null;
  }

  async createProblem(problem: Problem): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: problem,
    });
    await docClient.send(command);
  }

  async listAll(limit = 50): Promise<Problem[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: {
        ':sk': PROBLEM_SK,
      },
      Limit: limit,
    });

    const response = await docClient.send(command);
    return (response.Items as Problem[]) || [];
  }

  async filterByCategoryAndDifficulty(
    category: string,
    difficulty: ProblemDifficulty
  ): Promise<Problem[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: DYNAMODB_INDEXES.CATEGORY_DIFFICULTY,
      KeyConditionExpression: '#cat = :cat and #diff = :diff',
      ExpressionAttributeNames: {
        '#cat': 'category',
        '#diff': 'difficulty',
      },
      ExpressionAttributeValues: {
        ':cat': category,
        ':diff': difficulty,
      },
    });

    const response = await docClient.send(command);
    return (response.Items as Problem[]) || [];
  }

  async saveSubmission(submission: Submission): Promise<void> {
    const command = new PutCommand({
      TableName: this.tableName,
      Item: submission,
    });
    await docClient.send(command);
  }

  async listSubmissionsByProblem(problemId: string, limit = 20): Promise<Submission[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'problem_id = :pid and begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pid': problemId,
        ':prefix': SUBMISSION_SK_PREFIX,
      },
      ScanIndexForward: false, // newest first
      Limit: limit,
    });

    const response = await docClient.send(command);
    return (response.Items as Submission[]) || [];
  }

  async listSubmissionsByUser(userId: string, limit = 20): Promise<Submission[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: DYNAMODB_INDEXES.USER_SUBMISSIONS,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: {
        ':uid': String(userId),
      },
      ScanIndexForward: false, // newest first
      Limit: limit,
    });

    const response = await docClient.send(command);
    return (response.Items as Submission[]) || [];
  }
}

export const problemRepository = new ProblemRepository();
