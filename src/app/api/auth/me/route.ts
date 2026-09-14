import { NextRequest } from 'next/server';
import { extractBearerToken, verifyToken } from '@/lib/jwt';
import { authService } from '@/services/auth.service';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = extractBearerToken(authHeader);

    if (!token) {
      return apiError('Missing or invalid Authorization header', 401, 'UNAUTHORIZED');
    }

    const payload = verifyToken(token);
    if (!payload) {
      return apiError('Token has expired or is invalid', 401, 'INVALID_TOKEN');
    }

    const profile = await authService.getProfile(payload.id);
    if (!profile) {
      return apiError('User not found', 404, 'USER_NOT_FOUND');
    }

    return apiSuccess(profile);
  } catch (err: any) {
    return apiError(err.message || 'Internal server error', 500, 'SERVER_ERROR');
  }
}
