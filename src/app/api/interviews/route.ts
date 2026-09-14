import { NextRequest } from 'next/server';
import { z } from 'zod';
import { interviewService } from '@/services/interview.service';
import { extractBearerToken, verifyToken } from '@/lib/jwt';
import { apiSuccess, apiError } from '@/lib/api-response';

const startInterviewSchema = z.object({
  user_id: z.string().or(z.number()).transform(String),
  problem_id: z.string().min(1),
  interview_type: z.enum(['CODING', 'SYSTEM_DESIGN', 'BEHAVIORAL']).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  ai_model: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = startInterviewSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation error', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const result = await interviewService.startInterview(parsed.data);
    return apiSuccess(result, 201);
  } catch (err: any) {
    return apiError(err.message || 'Failed to start interview', 400, 'START_FAILED');
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let userId = searchParams.get('user_id');

    // If no user_id param, check Bearer token
    if (!userId) {
      const authHeader = req.headers.get('Authorization');
      const token = extractBearerToken(authHeader);
      if (token) {
        const payload = verifyToken(token);
        if (payload) {
          userId = String(payload.id);
        }
      }
    }

    if (!userId) {
      return apiError('user_id parameter or Authorization header is required', 400, 'MISSING_USER_ID');
    }

    const interviews = await interviewService.getUserInterviews(userId);
    return apiSuccess(interviews, 200, { count: interviews.length });
  } catch (err: any) {
    return apiError(err.message || 'Failed to list interviews', 500, 'FETCH_FAILED');
  }
}
