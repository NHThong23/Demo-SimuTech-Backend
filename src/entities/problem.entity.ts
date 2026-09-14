/**
 * Problem Entity (AWS DynamoDB - Single-Table Design)
 * Table: `Problems`
 * Partition Key (PK): `problem_id` (e.g. "prob_1")
 * Sort Key (SK): `METADATA`
 * Entity Type: `PROBLEM`
 * 
 * GSIs:
 * - category-difficulty-index: category (PK), difficulty (SK)
 */

export type ProblemDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type SupportedLanguage = 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'go' | string;

export interface TestCase {
  id: number;
  input: string;
  output: string;
  is_sample: boolean;
}

export interface Problem {
  /** Partition Key */
  problem_id: string;
  /** Sort Key: constant 'METADATA' */
  sk: 'METADATA';
  /** Discriminator */
  entity_type: 'PROBLEM';
  
  title: string;
  description: string;
  difficulty: ProblemDifficulty;
  category: string;
  starter_code: string;
  test_cases: TestCase[];
  hints: string[];
  tags: string[];
  companies: string[];
  interview_frequency: number; // 0 to 100
  constraints: string;
  follow_up_questions: string[];
  supported_languages: SupportedLanguage[];
  created_at: string; // ISO 8601 string
}

/**
 * Sanitized problem representation for candidates (hides non-sample test cases)
 */
export type PublicProblem = Omit<Problem, 'test_cases'> & {
  sample_test_cases: TestCase[];
};

export interface CreateProblemInput {
  problem_id?: string;
  title: string;
  description: string;
  difficulty: ProblemDifficulty;
  category: string;
  starter_code: string;
  test_cases: TestCase[];
  hints?: string[];
  tags?: string[];
  companies?: string[];
  interview_frequency?: number;
  constraints?: string;
  follow_up_questions?: string[];
  supported_languages?: SupportedLanguage[];
}

/**
 * Helpers for Problem Single-Table Design
 */
export const PROBLEM_SK = 'METADATA' as const;

export function isProblemEntity(item: { entity_type?: string }): item is Problem {
  return item.entity_type === 'PROBLEM';
}

export function toPublicProblem(problem: Problem): PublicProblem {
  const { test_cases, ...rest } = problem;
  return {
    ...rest,
    sample_test_cases: test_cases.filter((tc) => tc.is_sample),
  };
}
