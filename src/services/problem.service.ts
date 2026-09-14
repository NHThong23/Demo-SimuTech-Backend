import { problemRepository } from '@/repositories/problem.repository';
import {
  Problem,
  PublicProblem,
  ProblemDifficulty,
  CreateProblemInput,
  CreateSubmissionInput,
  Submission,
  toPublicProblem,
  makeSubmissionSK,
  PROBLEM_SK,
} from '@/entities';

export class ProblemService {
  async getProblemById(problemId: string, isAdmin = false): Promise<Problem | PublicProblem | null> {
    const problem = await problemRepository.findById(problemId);
    if (!problem) return null;

    return isAdmin ? problem : toPublicProblem(problem);
  }

  async listProblems(
    category?: string,
    difficulty?: ProblemDifficulty
  ): Promise<PublicProblem[]> {
    let problems: Problem[];

    if (category && difficulty) {
      problems = await problemRepository.filterByCategoryAndDifficulty(category, difficulty);
    } else {
      problems = await problemRepository.listAll();
    }

    return problems.map(toPublicProblem);
  }

  async createProblem(input: CreateProblemInput): Promise<Problem> {
    const problemId = input.problem_id || `prob_${Date.now()}`;
    const now = new Date().toISOString();

    const problem: Problem = {
      problem_id: problemId,
      sk: PROBLEM_SK,
      entity_type: 'PROBLEM',
      title: input.title,
      description: input.description,
      difficulty: input.difficulty,
      category: input.category,
      starter_code: input.starter_code,
      test_cases: input.test_cases,
      hints: input.hints || [],
      tags: input.tags || [],
      companies: input.companies || [],
      interview_frequency: input.interview_frequency || 50,
      constraints: input.constraints || '',
      follow_up_questions: input.follow_up_questions || [],
      supported_languages: input.supported_languages || ['python', 'javascript', 'java', 'cpp'],
      created_at: now,
    };

    await problemRepository.createProblem(problem);
    return problem;
  }

  async submitCode(
    input: CreateSubmissionInput,
    mockExecutionResult?: Partial<Submission>
  ): Promise<Submission> {
    const submissionId = `sub_${Date.now()}`;
    const now = new Date().toISOString();

    const submission: Submission = {
      problem_id: input.problem_id,
      sk: makeSubmissionSK(submissionId),
      entity_type: 'SUBMISSION',
      submission_id: submissionId,
      user_id: String(input.user_id),
      language: input.language,
      code: input.code,
      status: mockExecutionResult?.status || 'ACCEPTED',
      execution_time_ms: mockExecutionResult?.execution_time_ms || 45,
      memory_usage_kb: mockExecutionResult?.memory_usage_kb || 14200,
      test_cases_passed: mockExecutionResult?.test_cases_passed || 3,
      total_test_cases: mockExecutionResult?.total_test_cases || 3,
      error_message: mockExecutionResult?.error_message || null,
      ai_review: mockExecutionResult?.ai_review || 'Mã nguồn đáp ứng yêu cầu thuật toán.',
      interview_id: input.interview_id || null,
      created_at: now,
    };

    await problemRepository.saveSubmission(submission);
    return submission;
  }

  async getSubmissionsByProblem(problemId: string): Promise<Submission[]> {
    return problemRepository.listSubmissionsByProblem(problemId);
  }

  async getSubmissionsByUser(userId: string): Promise<Submission[]> {
    return problemRepository.listSubmissionsByUser(userId);
  }
}

export const problemService = new ProblemService();
