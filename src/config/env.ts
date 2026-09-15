import { z } from 'zod';

const envSchema = z.object({
  // MySQL Database Config
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('online_judge_db'),

  // AWS DynamoDB Config
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('localKey'),
  AWS_SECRET_ACCESS_KEY: z.string().default('secrectKey'),
  DYNAMODB_ENDPOINT_URL: z.string().optional(),
  DYNAMODB_PROBLEMS_TABLE: z.string().default('Problems'),
  DYNAMODB_INTERVIEWS_TABLE: z.string().default('Interviews'),

  // AI Provider Config
  // Chuyển đổi model: đổi AI_PROVIDER và thêm API key tương ứng
  AI_PROVIDER: z.enum(['mock', 'openai', 'gemini', 'anthropic']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-1.5-pro'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-20241022'),

  // JWT / Auth Config
  JWT_SECRET: z.string().default(process.env.NEXTAUTH_SECRET || 'simutech_jwt_secret_dev_key_2026'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Piston Code Execution Engine
  PISTON_API_URL: z.string().default('http://localhost:2000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  throw new Error('Invalid environment variables configuration');
}

export const env = parsed.data;
