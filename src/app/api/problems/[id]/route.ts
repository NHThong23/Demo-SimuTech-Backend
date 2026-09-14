import { NextRequest } from 'next/server';
import { problemService } from '@/services/problem.service';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const { searchParams } = new URL(req.url);
    const isAdmin = searchParams.get('admin') === 'true';

    const problem = await problemService.getProblemById(id, isAdmin);
    if (!problem) {
      return apiError(`Problem with id '${id}' not found`, 404, 'NOT_FOUND');
    }

    return apiSuccess(problem);
  } catch (err: any) {
    return apiError(err.message || 'Failed to fetch problem', 500, 'FETCH_FAILED');
  }
}
