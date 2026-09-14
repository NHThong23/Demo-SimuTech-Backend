import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, AuthError } from '@/lib/auth-guard';
import { authService } from '@/services/auth.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const changePasswordSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(6).max(100),
});

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation error', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    await authService.changePassword(user.id, parsed.data.old_password, parsed.data.new_password);
    return apiSuccess({ message: 'Đổi mật khẩu thành công' });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status, err.code);
    }
    return apiError(err.message || 'Change password failed', 400, 'CHANGE_PASSWORD_FAILED');
  }
}
