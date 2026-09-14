import { NextRequest } from 'next/server';
import { z } from 'zod';
import { authService } from '@/services/auth.service';
import { apiSuccess, apiError } from '@/lib/api-response';

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  full_name: z.string().optional(),
  target_role: z.string().optional(),
  skill_level: z.enum(['JUNIOR', 'MID', 'SENIOR']).optional(),
  bio: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return apiError('Validation failed', 422, 'VALIDATION_ERROR', parsed.error.format());
    }

    const result = await authService.register(parsed.data);
    return apiSuccess(result, 201);
  } catch (err: any) {
    return apiError(err.message || 'Registration failed', 400, 'REGISTRATION_FAILED');
  }
}
