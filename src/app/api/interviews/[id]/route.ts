import { NextRequest } from 'next/server';
import { interviewService } from '@/services/interview.service';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const context = await interviewService.getInterviewDetails(id);

    if (!context.session) {
      return apiError(`Interview session '${id}' not found`, 404, 'NOT_FOUND');
    }

    return apiSuccess(context);
  } catch (err: any) {
    return apiError(err.message || 'Failed to fetch interview details', 500, 'FETCH_FAILED');
  }
}
