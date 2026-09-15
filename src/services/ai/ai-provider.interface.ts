// =============================================================================
// AI PROVIDER INTERFACE — Strategy Pattern
//
// Định nghĩa "hợp đồng" chung cho mọi model AI. Khi tích hợp model thực
// (OpenAI, Gemini, Anthropic...), chỉ cần implement interface này — không
// cần sửa bất kỳ Service hay Route nào.
//
// Chuyển đổi provider bằng biến môi trường: AI_PROVIDER=mock | openai | gemini
// =============================================================================

import type { InterviewSession } from '@/entities/interview.entity';
import type { InterviewMessage } from '@/entities/chat-message.entity';
import type { CodeSnapshot } from '@/entities/code-snapshot.entity';

// ─── Shared Sub-types ────────────────────────────────────────────────────────

export interface ConversationTurn {
  sender: 'AI' | 'USER' | 'SYSTEM';
  content: string;
}

export interface ProblemContext {
  title: string;
  description: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  category: string;
}

export interface InterviewScores {
  problem_solving: number;    // 0–100
  code_quality: number;       // 0–100
  communication: number;      // 0–100
  time_management: number;    // 0–100
  optimization: number;       // 0–100
}

export type HireRecommendation =
  | 'STRONG_YES'
  | 'LEAN_YES'
  | 'LEAN_NO'
  | 'STRONG_NO';

// ─── Input / Output DTOs ─────────────────────────────────────────────────────

/** Input cho generate interview response (chat 2 chiều) */
export interface GenerateInterviewResponseInput {
  /** Lịch sử hội thoại tính đến trước tin nhắn hiện tại */
  conversationHistory: ConversationTurn[];
  /** Thông tin đề bài đang phỏng vấn */
  problemContext: ProblemContext;
  /** Tin nhắn mới nhất của ứng viên */
  userMessage: string;
}

/** Output cho generate interview response */
export interface GenerateInterviewResponseOutput {
  /** Nội dung phản hồi của AI */
  content: string;
  /** Phân loại tin nhắn AI — phải khớp với MessageType trong chat-message.entity.ts */
  messageType: 'QUESTION' | 'FEEDBACK' | 'HINT';
}

/** Input cho đánh giá toàn bộ phiên phỏng vấn */
export interface EvaluateInterviewInput {
  session: InterviewSession;
  messages: InterviewMessage[];
  codeSnapshots: CodeSnapshot[];
}

/** Output cho đánh giá toàn bộ phiên phỏng vấn */
export interface EvaluateInterviewOutput {
  scores: InterviewScores;
  overall_score: number;           // 0–100
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  hire_recommendation: HireRecommendation;
}

/** Input cho AI code review */
export interface ReviewCodeInput {
  code: string;
  language: string;
  problemTitle: string;
  problemDescription: string;
}

/** Serialized node/edge for system design (import-free định nghĩa lại ở đây để tránh circular) */
export interface SystemDesignNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: string;
    technology?: string;
    [key: string]: unknown;
  };
}

export interface SystemDesignEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  data?: { protocol?: string; isAsync?: boolean; qps?: string };
}

export interface SystemDesignArchitecture {
  nodes: SystemDesignNode[];
  edges: SystemDesignEdge[];
}

export interface BottleneckAnalysis {
  componentId: string;
  componentName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  issue: string;
  recommendation: string;
}

/** Input cho đánh giá kiến trúc system design */
export interface EvaluateSystemDesignInput {
  sessionId: string;
  scenarioTitle: string;
  requirementsPrompt: string;
  architecture: SystemDesignArchitecture;
}

/** Output cho đánh giá kiến trúc system design */
export interface EvaluateSystemDesignOutput {
  score: number;                    // 0–100
  scalabilityFeedback: string;
  availabilityFeedback: string;
  bottlenecks: BottleneckAnalysis[];
  suggestedAdditions: string[];
}

/** Input cho lời chào mở đầu phiên phỏng vấn */
export interface GenerateGreetingInput {
  problemTitle: string;
  interviewType: 'CODING' | 'SYSTEM_DESIGN' | 'BEHAVIORAL';
  candidateName?: string;
}

// ─── Provider Interface ───────────────────────────────────────────────────────

/**
 * IAIProvider — Interface chung cho mọi AI model.
 *
 * Để tích hợp model mới:
 * 1. Tạo file `<model>-ai-provider.ts` implement interface này
 * 2. Thêm case vào `AIProviderFactory`
 * 3. Set env var `AI_PROVIDER=<model>`
 */
export interface IAIProvider {
  /**
   * Lời chào mở đầu khi bắt đầu phiên phỏng vấn.
   */
  generateGreeting(input: GenerateGreetingInput): Promise<string>;

  /**
   * Phản hồi chat tương tác 2 chiều trong phiên phỏng vấn.
   * Nhận lịch sử hội thoại + tin nhắn mới, trả về phản hồi phù hợp.
   */
  generateInterviewResponse(
    input: GenerateInterviewResponseInput
  ): Promise<GenerateInterviewResponseOutput>;

  /**
   * Chấm điểm và tổng hợp đánh giá khi kết thúc phiên phỏng vấn.
   * Phân tích toàn bộ chat history + code snapshots.
   */
  evaluateInterview(input: EvaluateInterviewInput): Promise<EvaluateInterviewOutput>;

  /**
   * Review chất lượng code (gọi khi lưu code snapshot hoặc submit).
   * Trả về comment ngắn gọn về code quality.
   */
  reviewCode(input: ReviewCodeInput): Promise<string>;

  /**
   * Phân tích và đánh giá kiến trúc system design từ React Flow diagram.
   */
  evaluateSystemDesign(input: EvaluateSystemDesignInput): Promise<EvaluateSystemDesignOutput>;
}
