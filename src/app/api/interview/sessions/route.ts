import { NextRequest, NextResponse } from 'next/server';
import { interviewService } from '@/services/interview.service';
import { getOptionalAuth } from '@/lib/auth-guard';
import { apiError } from '@/lib/api-response';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { targetRole = 'backend', seniorityLevel = 'junior', interviewType = 'coding', candidateName } = body;

    // Detect authenticated user from JWT token if available
    const authUser = getOptionalAuth(req);
    const userId = authUser
      ? String(authUser.id)
      : candidateName
      ? `user_${candidateName.toLowerCase().replace(/\s+/g, '_')}`
      : '2';

    const problemId = body.problemId || 'prob_1';

    const { session } = await interviewService.startInterview({
      user_id: userId,
      problem_id: problemId,
      interview_type: interviewType.toUpperCase() as any,
    });

    const sessionDetail = {
      id: session.interview_id,
      targetRole,
      seniorityLevel,
      interviewType,
      status: 'in_progress',
      startedAt: session.started_at,
      totalDurationSeconds: 0,
    };

    return NextResponse.json(sessionDetail, { status: 201 });
  } catch (err: any) {
    return apiError(err.message || 'Failed to create session', 400, 'CREATE_SESSION_FAILED');
  }
}
