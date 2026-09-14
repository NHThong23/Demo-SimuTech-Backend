import { NextRequest } from 'next/server';
import { interviewService } from '@/services/interview.service';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const evaluation = await interviewService.completeAndEvaluateInterview(id);

    return apiSuccess(evaluation, 200);
  } catch (err: any) {
    return apiError(err.message || 'Failed to complete and evaluate interview', 400, 'EVALUATION_FAILED');
  }
}
