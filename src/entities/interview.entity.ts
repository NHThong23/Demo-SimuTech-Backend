/**
 * Interview Session Entity (AWS DynamoDB - Single-Table Design)
 * Table: `Interviews`
 * Partition Key (PK): `interview_id` (e.g. "intv_1725700000001")
 * Sort Key (SK): `METADATA`
 * Entity Type: `INTERVIEW`
 * 
 * GSIs:
 * - user-interviews-index: user_id (PK), started_at (SK)
 * - problem-interviews-index: problem_id (PK), started_at (SK)
 */

import { ProblemDifficulty } from './problem.entity';

export type InterviewType = 'CODING' | 'SYSTEM_DESIGN' | 'BEHAVIORAL';

export type InterviewStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface InterviewSession {
  /** Partition Key */
  interview_id: string;
  /** Sort Key: constant 'METADATA' */
  sk: 'METADATA';
  /** Discriminator */
  entity_type: 'INTERVIEW';

  /** Candidate User ID (GSI PK for user-interviews-index) */
  user_id: string;
  /** Target Problem ID (GSI PK for problem-interviews-index) */
  problem_id: string;

  interview_type: InterviewType;
  difficulty: ProblemDifficulty;
  status: InterviewStatus;
  ai_model: string; // e.g. "gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"
  duration_seconds: number;
  overall_score: number | null; // e.g. 78 (0-100) or null if in progress

  /** GSI Sort Key for both indexes (ISO 8601) */
  started_at: string;
  completed_at: string | null;
}

export interface CreateInterviewInput {
  user_id: string;
  problem_id: string;
  interview_type?: InterviewType;
  difficulty?: ProblemDifficulty;
  ai_model?: string;
}

export const INTERVIEW_SK = 'METADATA' as const;

export function isInterviewEntity(item: { entity_type?: string }): item is InterviewSession {
  return item.entity_type === 'INTERVIEW';
}
