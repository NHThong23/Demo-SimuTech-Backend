import bcrypt from 'bcryptjs';
import { userRepository } from '@/repositories/user.repository';
import { CreateUserInput, PublicUserProfile, UpdateUserProfileInput } from '@/entities';
import { signToken } from '@/lib/jwt';

export class AuthService {
  async register(input: CreateUserInput): Promise<{ user: PublicUserProfile; token: string }> {
    // 1. Check if username or email already exists
    const existingUsername = await userRepository.findByUsername(input.username);
    if (existingUsername) {
      throw new Error('Username is already taken');
    }

    const existingEmail = await userRepository.findByEmail(input.email);
    if (existingEmail) {
      throw new Error('Email is already registered');
    }

    // 2. Hash password with bcrypt
    const hashedPassword = await bcrypt.hash(input.password, 10);

    // 3. Persist to MySQL
    const newUser = await userRepository.create({
      ...input,
      password: hashedPassword,
    });

    // 4. Generate JWT token
    const token = signToken({
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
    });

    // 5. Return sanitized profile
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...publicUser } = newUser;
    return { user: publicUser, token };
  }

  async login(
    usernameOrEmail: string,
    plainPassword: string
  ): Promise<{ user: PublicUserProfile; token: string }> {
    // 1. Look up user by username or email
    let user = await userRepository.findByUsername(usernameOrEmail);
    if (!user) {
      user = await userRepository.findByEmail(usernameOrEmail);
    }

    if (!user || !user.password) {
      throw new Error('Invalid credentials');
    }

    // 2. Compare bcrypt password
    const isPasswordValid = await bcrypt.compare(plainPassword, user.password);
    if (!isPasswordValid) {
      throw new Error('Invalid credentials');
    }

    // 3. Issue JWT token
    const token = signToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });

    // 4. Return sanitized profile
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...publicUser } = user;
    return { user: publicUser, token };
  }

  async getProfile(userId: number): Promise<PublicUserProfile | null> {
    const user = await userRepository.findById(userId);
    if (!user) return null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...publicUser } = user;
    return publicUser;
  }

  async updateProfile(userId: number, input: UpdateUserProfileInput): Promise<PublicUserProfile> {
    await userRepository.updateProfile(userId, input);
    const updated = await this.getProfile(userId);
    if (!updated) {
      throw new Error('User not found');
    }
    return updated;
  }

  async changePassword(userId: number, oldPass: string, newPass: string): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user || !user.password) {
      throw new Error('User not found');
    }

    const isValid = await bcrypt.compare(oldPass, user.password);
    if (!isValid) {
      throw new Error('Mật khẩu hiện tại không chính xác');
    }

    const hashed = await bcrypt.hash(newPass, 10);
    await userRepository.updatePassword(userId, hashed);
  }

  async listAllUsers(): Promise<PublicUserProfile[]> {
    const users = await userRepository.listAllUsers();
    return users.map((u) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...publicUser } = u;
      return publicUser;
    });
  }
}

export const authService = new AuthService();
