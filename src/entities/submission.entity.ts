/**
 * Submission Entity (AWS DynamoDB - Single-Table Design)
 * Table: `Problems`
 * Partition Key (PK): `problem_id` (e.g. "prob_1")
 * Sort Key (SK): `SUBMISSION#<submission_id>` (e.g. "SUBMISSION#sub_1725700000001")
 * Entity Type: `SUBMISSION`
 * 
 * GSIs:
 * - user-submissions-index: user_id (PK), created_at (SK)
 */

export type SubmissionStatus =
  | 'ACCEPTED'
  | 'WRONG_ANSWER'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'RUNTIME_ERROR'
  | 'COMPILE_ERROR'
  | 'PENDING';

export interface Submission {
  /** Partition Key: references the problem */
  problem_id: string;
  /** Sort Key: SUBMISSION#<submission_id> */
  sk: `SUBMISSION#${string}`;
  /** Discriminator */
  entity_type: 'SUBMISSION';

  submission_id: string;
  /** GSI Partition Key for user-submissions-index */
  user_id: string;
  language: string;
  code: string;
  status: SubmissionStatus;
  execution_time_ms: number;
  memory_usage_kb: number;
  test_cases_passed: number;
  total_test_cases: number;
  error_message: string | null;
  ai_review: string | null;
  /** Linked interview session ID if submitted inside an interview */
  interview_id: string | null;
  /** GSI Sort Key for user-submissions-index (ISO 8601) */
  created_at: string;
}

export interface CreateSubmissionInput {
  problem_id: string;
  user_id: string;
  language: string;
  code: string;
  interview_id?: string | null;
}

export const SUBMISSION_SK_PREFIX = 'SUBMISSION#' as const;

export function makeSubmissionSK(submissionId: string): `SUBMISSION#${string}` {
  return `${SUBMISSION_SK_PREFIX}${submissionId}`;
}

export function extractSubmissionIdFromSK(sk: string): string {
  return sk.replace(SUBMISSION_SK_PREFIX, '');
}

export function isSubmissionEntity(item: { entity_type?: string }): item is Submission {
  return item.entity_type === 'SUBMISSION';
}
