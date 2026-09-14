import { NextRequest, NextResponse } from 'next/server';
import { interviewService } from '@/services/interview.service';
import { apiError } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const context = await interviewService.getInterviewDetails(id);

    if (!context.session) {
      return apiError(`Session with id '${id}' not found`, 404, 'NOT_FOUND');
    }

    const s = context.session;
    return NextResponse.json({
      id: s.interview_id,
      targetRole: 'backend',
      seniorityLevel: 'junior',
      interviewType: s.interview_type.toLowerCase(),
      status: s.status.toLowerCase(),
      startedAt: s.started_at,
      completedAt: s.completed_at || undefined,
      totalDurationSeconds: s.duration_seconds || 0,
      session: s,
      messages: context.messages,
      snapshots: context.snapshots,
    });
  } catch (err: any) {
    return apiError(err.message || 'Failed to fetch session', 500, 'FETCH_FAILED');
  }
}
