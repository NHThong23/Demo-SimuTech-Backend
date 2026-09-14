import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, AuthError } from '@/lib/auth-guard';
import { authService } from '@/services/auth.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const updateProfileSchema = z.object({
  full_name: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional().or(z.literal('')),
  skill_level: z.enum(['JUNIOR', 'MID', 'SENIOR']).optional(),
  target_role: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const profile = await authService.getProfile(user.id);

    if (!profile) {
      return apiError('User not found', 404, 'USER_NOT_FOUND');
    }

    return apiSuccess(profile);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status, err.code);
    }
    return apiError(err.message || 'Internal server error', 500, 'SERVER_ERROR');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req);
    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation error', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const updated = await authService.updateProfile(user.id, parsed.data);
    return apiSuccess(updated);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status, err.code);
    }
    return apiError(err.message || 'Failed to update profile', 400, 'UPDATE_FAILED');
  }
}
