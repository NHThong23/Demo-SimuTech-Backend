/**
 * Barrel export for AI Provider module.
 *
 * Import usage throughout the codebase:
 *   import { aiProvider } from '@/services/ai';
 *   import type { IAIProvider, EvaluateInterviewOutput } from '@/services/ai';
 */

export type {
  IAIProvider,
  ConversationTurn,
  ProblemContext,
  InterviewScores,
  HireRecommendation,
  GenerateGreetingInput,
  GenerateInterviewResponseInput,
  GenerateInterviewResponseOutput,
  EvaluateInterviewInput,
  EvaluateInterviewOutput,
  ReviewCodeInput,
  SystemDesignArchitecture,
  SystemDesignNode,
  SystemDesignEdge,
  BottleneckAnalysis,
  EvaluateSystemDesignInput,
  EvaluateSystemDesignOutput,
} from './ai-provider.interface';

export { aiProvider } from './ai-provider.factory';
export type { AIProviderType } from './ai-provider.factory';
