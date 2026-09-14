import { NextRequest } from 'next/server';
import { z } from 'zod';
import { problemService } from '@/services/problem.service';
import { ProblemDifficulty } from '@/entities';
import { apiSuccess, apiError } from '@/lib/api-response';

const createProblemSchema = z.object({
  problem_id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  category: z.string().min(1),
  starter_code: z.string().min(1),
  test_cases: z.array(
    z.object({
      id: z.number(),
      input: z.string(),
      output: z.string(),
      is_sample: z.boolean(),
    })
  ),
  hints: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  companies: z.array(z.string()).optional(),
  interview_frequency: z.number().optional(),
  constraints: z.string().optional(),
  follow_up_questions: z.array(z.string()).optional(),
  supported_languages: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || undefined;
    const difficulty = (searchParams.get('difficulty') as ProblemDifficulty) || undefined;

    const problems = await problemService.listProblems(category, difficulty);
    return apiSuccess(problems, 200, { count: problems.length });
  } catch (err: any) {
    return apiError(err.message || 'Failed to fetch problems', 500, 'FETCH_FAILED');
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createProblemSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation error', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const created = await problemService.createProblem(parsed.data);
    return apiSuccess(created, 201);
  } catch (err: any) {
    return apiError(err.message || 'Failed to create problem', 400, 'CREATE_FAILED');
  }
}
