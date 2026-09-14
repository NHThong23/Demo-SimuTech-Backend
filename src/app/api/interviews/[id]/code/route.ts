import { NextRequest } from 'next/server';
import { z } from 'zod';
import { interviewService } from '@/services/interview.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const codeSnapshotSchema = z.object({
  language: z.string().min(1),
  code: z.string(),
  test_results: z.object({
    passed: z.number(),
    total: z.number(),
    details: z.array(
      z.object({
        test_id: z.number(),
        status: z.enum(['PASSED', 'FAILED', 'ERROR']),
        execution_time_ms: z.number().optional(),
        actual_output: z.string().optional(),
        expected_output: z.string().optional(),
      })
    ),
  }),
  ai_code_review: z.string().optional().nullable(),
});

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const body = await req.json();
    const parsed = codeSnapshotSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation failed', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const snapshot = await interviewService.saveCodeSnapshot(id, parsed.data);
    return apiSuccess(snapshot, 201);
  } catch (err: any) {
    return apiError(err.message || 'Failed to save code snapshot', 400, 'SAVE_CODE_FAILED');
  }
}
