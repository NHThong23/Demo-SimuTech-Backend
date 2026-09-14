import { NextRequest } from 'next/server';
import { z } from 'zod';
import { problemService } from '@/services/problem.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const submitSchema = z.object({
  problem_id: z.string().min(1),
  user_id: z.string().or(z.number()).transform(String),
  language: z.string().min(1),
  code: z.string().min(1),
  interview_id: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = submitSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation failed', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const submission = await problemService.submitCode(parsed.data);
    return apiSuccess(submission, 201);
  } catch (err: any) {
    return apiError(err.message || 'Submission failed', 400, 'SUBMISSION_FAILED');
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const problemId = searchParams.get('problem_id');
    const userId = searchParams.get('user_id');

    if (problemId) {
      const submissions = await problemService.getSubmissionsByProblem(problemId);
      return apiSuccess(submissions, 200, { count: submissions.length });
    }

    if (userId) {
      const submissions = await problemService.getSubmissionsByUser(userId);
      return apiSuccess(submissions, 200, { count: submissions.length });
    }

    return apiError('Either problem_id or user_id query parameter is required', 400, 'MISSING_QUERY_PARAM');
  } catch (err: any) {
    return apiError(err.message || 'Failed to list submissions', 500, 'FETCH_FAILED');
  }
}
