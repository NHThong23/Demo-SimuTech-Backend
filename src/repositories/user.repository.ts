import { query, execute } from '@/lib/db/mysql';
import { User, CreateUserInput, UpdateUserProfileInput } from '@/entities';

export class UserRepository {
  async findById(id: number): Promise<User | null> {
    const rows = await query<User>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const rows = await query<User>('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
    return rows[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await query<User>('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const sql = `
      INSERT INTO users (username, email, password, full_name, avatar_url, role, skill_level, target_role, bio)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      input.username,
      input.email,
      input.password,
      input.full_name || null,
      input.avatar_url || null,
      input.role || 'CANDIDATE',
      input.skill_level || 'JUNIOR',
      input.target_role || null,
      input.bio || null,
    ];

    const result = await execute(sql, params);
    const createdUser = await this.findById(result.insertId);
    if (!createdUser) {
      throw new Error('Failed to retrieve newly created user');
    }
    return createdUser;
  }

  async updateProfile(id: number, input: UpdateUserProfileInput): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (input.full_name !== undefined) {
      fields.push('full_name = ?');
      values.push(input.full_name);
    }
    if (input.avatar_url !== undefined) {
      fields.push('avatar_url = ?');
      values.push(input.avatar_url);
    }
    if (input.skill_level !== undefined) {
      fields.push('skill_level = ?');
      values.push(input.skill_level);
    }
    if (input.target_role !== undefined) {
      fields.push('target_role = ?');
      values.push(input.target_role);
    }
    if (input.bio !== undefined) {
      fields.push('bio = ?');
      values.push(input.bio);
    }

    if (fields.length === 0) return;

    values.push(id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    await execute(sql, values);
  }

  /**
   * Recalculates user's total_interviews and average interview score after completing an interview session.
   */
  async recordInterviewResult(userId: number, sessionScore: number): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;

    const newTotal = user.total_interviews + 1;
    const currentAvg = Number(user.avg_score) || 0;
    const newAvg = Number(((currentAvg * user.total_interviews + sessionScore) / newTotal).toFixed(1));

    await execute(
      'UPDATE users SET total_interviews = ?, avg_score = ? WHERE id = ?',
      [newTotal, newAvg, userId]
    );
  }
}

export const userRepository = new UserRepository();
