/**
 * User Entity (MySQL - Relational Database)
 * Table: `users`
 * 
 * Manages authentication, user profile, role-based access control,
 * and aggregated interview statistics.
 */

export type UserRole = 'CANDIDATE' | 'ADMIN';

export type SkillLevel = 'JUNIOR' | 'MID' | 'SENIOR';

export interface User {
  id: number;
  username: string;
  email: string;
  password?: string; // Hashed password (omitted in responses)
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  skill_level: SkillLevel;
  target_role: string | null; // e.g. "Backend Developer", "Frontend Developer"
  bio: string | null;
  total_interviews: number;
  avg_score: number; // 0.0 - 100.0
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Public User Profile (safe to return to frontend / other users)
 */
export type PublicUserProfile = Omit<User, 'password'>;

/**
 * DTO for creating a new user during registration
 */
export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: UserRole;
  skill_level?: SkillLevel;
  target_role?: string | null;
  bio?: string | null;
}

/**
 * DTO for updating user profile
 */
export interface UpdateUserProfileInput {
  full_name?: string | null;
  avatar_url?: string | null;
  skill_level?: SkillLevel;
  target_role?: string | null;
  bio?: string | null;
}
