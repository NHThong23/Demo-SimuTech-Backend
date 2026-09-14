import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authService } from '@/services/auth.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const loginSchema = z.object({
  usernameOrEmail: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation failed', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const result = await authService.login(
      parsed.data.usernameOrEmail,
      parsed.data.password
    );

    return apiSuccess(result);
  } catch (err: any) {
    return apiError(err.message || 'Login failed', 401, 'INVALID_CREDENTIALS');
  }
}
