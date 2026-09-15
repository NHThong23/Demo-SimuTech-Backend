// =============================================================================
// AI PROVIDER FACTORY — Chọn provider dựa trên biến môi trường AI_PROVIDER
//
// Cách thêm model AI mới:
//   1. Tạo file `<model>-ai-provider.ts` implement interface IAIProvider
//   2. Import class vào đây và thêm case trong createAIProvider()
//   3. Đổi .env: AI_PROVIDER=<model>
//   4. Không cần sửa bất kỳ Service hay Route nào khác
//
// Ví dụ tương lai:
//   case 'openai':   return new OpenAIProvider(env.OPENAI_API_KEY);
//   case 'gemini':   return new GeminiProvider(env.GEMINI_API_KEY);
//   case 'anthropic':return new AnthropicProvider(env.ANTHROPIC_API_KEY);
// =============================================================================

import type { IAIProvider } from './ai-provider.interface';
import { MockAIProvider } from './mock-ai-provider';

export type AIProviderType = 'mock' | 'openai' | 'gemini' | 'anthropic';

/**
 * Factory tạo AI Provider phù hợp với cấu hình.
 * Được gọi một lần khi khởi động server (singleton pattern).
 */
function createAIProvider(): IAIProvider {
  const providerType = (process.env.AI_PROVIDER || 'mock').toLowerCase() as AIProviderType;

  switch (providerType) {
    case 'mock':
      console.log('[AI] Using MockAIProvider — set AI_PROVIDER=openai|gemini to switch');
      return new MockAIProvider();

    // ─── Uncomment và implement khi đã chọn được model ────────────────────
    //
    // case 'openai': {
    //   const { OpenAIProvider } = require('./openai-ai-provider');
    //   return new OpenAIProvider({
    //     apiKey: process.env.OPENAI_API_KEY!,
    //     model: process.env.OPENAI_MODEL || 'gpt-4o',
    //   });
    // }
    //
    // case 'gemini': {
    //   const { GeminiProvider } = require('./gemini-ai-provider');
    //   return new GeminiProvider({
    //     apiKey: process.env.GEMINI_API_KEY!,
    //     model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
    //   });
    // }
    //
    // case 'anthropic': {
    //   const { AnthropicProvider } = require('./anthropic-ai-provider');
    //   return new AnthropicProvider({
    //     apiKey: process.env.ANTHROPIC_API_KEY!,
    //     model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    //   });
    // }
    // ──────────────────────────────────────────────────────────────────────

    default:
      console.warn(`[AI] Unknown provider "${providerType}", falling back to MockAIProvider`);
      return new MockAIProvider();
  }
}

/**
 * Singleton instance — chia sẻ giữa tất cả Service/Route trong cùng process.
 * Sử dụng globalThis để tránh tạo lại khi Next.js hot-reload trong dev.
 */
declare global {
  // eslint-disable-next-line no-var
  var __aiProviderInstance: IAIProvider | undefined;
}

export const aiProvider: IAIProvider =
  global.__aiProviderInstance ?? createAIProvider();

if (process.env.NODE_ENV !== 'production') {
  global.__aiProviderInstance = aiProvider;
}
