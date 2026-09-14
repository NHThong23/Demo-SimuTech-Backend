/**
 * AI Evaluation Entity (AWS DynamoDB - Single-Table Design)
 * Table: `Interviews`
 * Partition Key (PK): `interview_id` (e.g. "intv_1725700000001")
 * Sort Key (SK): `EVAL#<eval_id>` (e.g. "EVAL#eval_001")
 * Entity Type: `EVALUATION`
 */

export type HireRecommendation =
  | 'STRONG_NO'
  | 'NO'
  | 'LEAN_NO'
  | 'LEAN_YES'
  | 'YES'
  | 'STRONG_YES';

export interface EvaluationScores {
  /** Problem solving and algorithm choice (0-100) */
  problem_solving: number;
  /** Code readability, naming, structure (0-100) */
  code_quality: number;
  /** Explaining approach, asking clarifying questions (0-100) */
  communication: number;
  /** Pacing and completing within time limit (0-100) */
  time_management: number;
  /** Time and space complexity trade-offs (0-100) */
  optimization: number;
}

export interface AIEvaluation {
  /** Partition Key: references the interview session */
  interview_id: string;
  /** Sort Key: EVAL#<eval_id> */
  sk: `EVAL#${string}`;
  /** Discriminator */
  entity_type: 'EVALUATION';

  scores: EvaluationScores;
  overall_score: number; // 0-100
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  hire_recommendation: HireRecommendation;
  created_at: string; // ISO 8601
}

export interface CreateAIEvaluationInput {
  interview_id: string;
  eval_id?: string;
  scores: EvaluationScores;
  overall_score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  hire_recommendation: HireRecommendation;
}

export const EVALUATION_SK_PREFIX = 'EVAL#' as const;

export function makeEvaluationSK(evalId: string): `EVAL#${string}` {
  return `${EVALUATION_SK_PREFIX}${evalId}`;
}

export function isAIEvaluationEntity(item: { entity_type?: string }): item is AIEvaluation {
  return item.entity_type === 'EVALUATION';
}
