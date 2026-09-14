/**
 * Code Snapshot Entity (AWS DynamoDB - Single-Table Design)
 * Table: `Interviews`
 * Partition Key (PK): `interview_id` (e.g. "intv_1725700000001")
 * Sort Key (SK): `CODE#<timestamp>` (e.g. "CODE#2026-09-07T10:15:00Z")
 * Entity Type: `CODE_SNAPSHOT`
 */

export type TestCaseExecutionStatus = 'PASSED' | 'FAILED' | 'ERROR';

export interface TestCaseResultDetail {
  test_id: number;
  status: TestCaseExecutionStatus;
  execution_time_ms?: number;
  actual_output?: string;
  expected_output?: string;
}

export interface CodeSnapshotTestResults {
  passed: number;
  total: number;
  details: TestCaseResultDetail[];
}

export interface CodeSnapshot {
  /** Partition Key: references the interview session */
  interview_id: string;
  /** Sort Key: CODE#<timestamp> */
  sk: `CODE#${string}`;
  /** Discriminator */
  entity_type: 'CODE_SNAPSHOT';

  language: string;
  code: string;
  test_results: CodeSnapshotTestResults;
  ai_code_review: string | null;
  created_at: string; // ISO 8601
}

export interface CreateCodeSnapshotInput {
  interview_id: string;
  language: string;
  code: string;
  test_results: CodeSnapshotTestResults;
  ai_code_review?: string | null;
}

export const CODE_SNAPSHOT_SK_PREFIX = 'CODE#' as const;

export function makeCodeSnapshotSK(createdAtIso: string): `CODE#${string}` {
  return `${CODE_SNAPSHOT_SK_PREFIX}${createdAtIso}`;
}

export function isCodeSnapshotEntity(item: { entity_type?: string }): item is CodeSnapshot {
  return item.entity_type === 'CODE_SNAPSHOT';
}
