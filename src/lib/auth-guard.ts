import { NextRequest } from 'next/server';
import { extractBearerToken, verifyToken, AuthTokenPayload } from './jwt';
import { UserRole } from '@/entities';

export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Validates that the request has a valid Bearer token.
 * Throws AuthError(401) if token is missing or invalid.
 */
export function requireAuth(req: NextRequest): AuthTokenPayload {
  const authHeader = req.headers.get('Authorization');
  const token = extractBearerToken(authHeader);

  if (!token) {
    throw new AuthError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header');
  }

  const payload = verifyToken(token);
  if (!payload) {
    throw new AuthError(401, 'INVALID_TOKEN', 'Token has expired or is invalid');
  }

  return payload;
}

/**
 * Validates that the request has a valid token with a specific role.
 * Throws AuthError(403) if the user does not have the required role.
 */
export function requireRole(req: NextRequest, allowedRole: UserRole): AuthTokenPayload {
  const user = requireAuth(req);

  if (user.role !== allowedRole) {
    throw new AuthError(403, 'FORBIDDEN', `Access restricted to ${allowedRole} role`);
  }

  return user;
}

/**
 * Convenience helper to require ADMIN role.
 */
export function requireAdmin(req: NextRequest): AuthTokenPayload {
  return requireRole(req, 'ADMIN');
}

/**
 * Optionally extracts user if valid token exists, returns null otherwise without throwing.
 */
export function getOptionalAuth(req: NextRequest): AuthTokenPayload | null {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}
