import { NextRequest, NextResponse } from 'next/server';
import { interviewService } from '@/services/interview.service';
import { apiError } from '@/lib/api-response';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    await interviewService.completeAndEvaluateInterview(id);

    return NextResponse.json({
      success: true,
      reportReady: true,
    });
  } catch (err: any) {
    return apiError(err.message || 'Failed to finish session', 400, 'FINISH_FAILED');
  }
}
