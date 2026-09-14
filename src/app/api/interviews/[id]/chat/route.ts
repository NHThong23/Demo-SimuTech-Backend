import { NextRequest } from 'next/server';
import { z } from 'zod';
import { interviewService } from '@/services/interview.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const messageSchema = z.object({
  content: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const body = await req.json();
    const parsed = messageSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation failed', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const result = await interviewService.sendUserMessage(id, parsed.data.content);
    return apiSuccess(result, 201);
  } catch (err: any) {
    return apiError(err.message || 'Failed to send message', 400, 'SEND_MESSAGE_FAILED');
  }
}
