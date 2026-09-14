import { NextRequest } from 'next/server';
import { requireAdmin, AuthError } from '@/lib/auth-guard';
import { authService } from '@/services/auth.service';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    // Only ADMIN role is authorized to view complete users list
    requireAdmin(req);

    const users = await authService.listAllUsers();
    return apiSuccess(users, 200, { total: users.length });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status, err.code);
    }
    return apiError(err.message || 'Failed to list users', 500, 'FETCH_USERS_FAILED');
  }
}
