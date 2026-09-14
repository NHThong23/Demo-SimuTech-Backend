/**
 * DynamoDB Single-Table Design Types & Constants
 * 
 * Defines table item union types, index names, and table names
 * matching the schema in `setup-dynamodb.sh` and `README-DYNAMODB.md`.
 */

import { Problem } from './problem.entity';
import { Submission } from './submission.entity';
import { InterviewSession } from './interview.entity';
import { InterviewMessage } from './chat-message.entity';
import { CodeSnapshot } from './code-snapshot.entity';
import { AIEvaluation } from './ai-evaluation.entity';

/**
 * Union of all items stored in the 'Problems' table
 */
export type ProblemsTableItem = Problem | Submission;

/**
 * Union of all items stored in the 'Interviews' table
 */
export type InterviewsTableItem =
  | InterviewSession
  | InterviewMessage
  | CodeSnapshot
  | AIEvaluation;

/**
 * All entity types across NoSQL tables
 */
export type DynamoDBEntityType =
  | 'PROBLEM'
  | 'SUBMISSION'
  | 'INTERVIEW'
  | 'MESSAGE'
  | 'CODE_SNAPSHOT'
  | 'EVALUATION';

/**
 * Table names configured in the environment
 */
export const DYNAMODB_TABLES = {
  PROBLEMS: process.env.DYNAMODB_PROBLEMS_TABLE || 'Problems',
  INTERVIEWS: process.env.DYNAMODB_INTERVIEWS_TABLE || 'Interviews',
} as const;

/**
 * Global Secondary Indexes (GSIs)
 */
export const DYNAMODB_INDEXES = {
  // Problems Table GSIs
  USER_SUBMISSIONS: 'user-submissions-index',
  CATEGORY_DIFFICULTY: 'category-difficulty-index',

  // Interviews Table GSIs
  USER_INTERVIEWS: 'user-interviews-index',
  PROBLEM_INTERVIEWS: 'problem-interviews-index',
} as const;
