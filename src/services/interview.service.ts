import { interviewRepository } from '@/repositories/interview.repository';
import { userRepository } from '@/repositories/user.repository';
import { problemRepository } from '@/repositories/problem.repository';
import {
  InterviewSession,
  InterviewMessage,
  CodeSnapshot,
  AIEvaluation,
  CreateInterviewInput,
  CreateCodeSnapshotInput,
  INTERVIEW_SK,
  makeMessageSK,
  makeCodeSnapshotSK,
  makeEvaluationSK,
} from '@/entities';

export class InterviewService {
  async startInterview(input: CreateInterviewInput): Promise<{
    session: InterviewSession;
    initialMessage: InterviewMessage;
  }> {
    const interviewId = `intv_${Date.now()}`;
    const now = new Date().toISOString();

    // Check if problem exists
    const problem = await problemRepository.findById(input.problem_id);
    const problemTitle = problem ? problem.title : 'bài toán';

    // 1. Create Interview Session Metadata
    const session: InterviewSession = {
      interview_id: interviewId,
      sk: INTERVIEW_SK,
      entity_type: 'INTERVIEW',
      user_id: String(input.user_id),
      problem_id: input.problem_id,
      interview_type: input.interview_type || 'CODING',
      difficulty: input.difficulty || (problem ? problem.difficulty : 'EASY'),
      status: 'IN_PROGRESS',
      ai_model: input.ai_model || 'gpt-4o',
      duration_seconds: 0,
      overall_score: null,
      started_at: now,
      completed_at: null,
    };

    await interviewRepository.createSession(session);

    // 2. Create AI Interviewer Initial Message
    const msgId = `msg_${Date.now()}`;
    const greetingTime = new Date().toISOString();
    const initialMessage: InterviewMessage = {
      interview_id: interviewId,
      sk: makeMessageSK(greetingTime, msgId),
      entity_type: 'MESSAGE',
      sender: 'AI',
      content: `Chào bạn! Tôi là AI Interviewer của bạn hôm nay. Chúng ta sẽ cùng trao đổi và giải quyết bài toán "${problemTitle}". Trước khi bắt đầu viết mã nguồn, bạn hãy chia sẻ hướng tiếp cận (approach) và phân tích sơ bộ độ phức tạp nhé!`,
      message_type: 'QUESTION',
      created_at: greetingTime,
    };

    await interviewRepository.addMessage(initialMessage);

    return { session, initialMessage };
  }

  async sendUserMessage(interviewId: string, content: string): Promise<{
    userMessage: InterviewMessage;
    aiMessage: InterviewMessage;
  }> {
    const userTimestamp = new Date().toISOString();
    const userMsgId = `msg_${Date.now()}`;

    // 1. Save user's message
    const userMessage: InterviewMessage = {
      interview_id: interviewId,
      sk: makeMessageSK(userTimestamp, userMsgId),
      entity_type: 'MESSAGE',
      sender: 'USER',
      content,
      message_type: 'ANSWER',
      created_at: userTimestamp,
    };
    await interviewRepository.addMessage(userMessage);

    // 2. Generate simulated intelligent AI response
    // (In production, this calls OpenAI / Gemini with conversation context)
    const aiTimestamp = new Date(Date.now() + 1000).toISOString();
    const aiMsgId = `msg_${Date.now() + 1}`;
    
    let aiContent = 'Cảm ơn chia sẻ của bạn. Hướng tiếp cận rất hợp lý! Bạn hãy bắt đầu hiện thực hóa bằng code vào trình soạn thảo và chạy thử các test case mẫu nhé.';
    if (content.toLowerCase().includes('brute force') || content.toLowerCase().includes('o(n^2)') || content.toLowerCase().includes('o(n2)')) {
      aiContent = 'Tốt lắm, bạn đã nhận diện được phương pháp cơ bản brute force. Nhưng liệu có cách nào tối ưu hơn không? Hãy thử suy nghĩ xem có cấu trúc dữ liệu nào giúp tra cứu (lookup) với độ phức tạp O(1) không nhé.';
    } else if (content.toLowerCase().includes('hashmap') || content.toLowerCase().includes('map') || content.toLowerCase().includes('dictionary')) {
      aiContent = 'Rất tuyệt vời! Sử dụng Hash Map là hướng giải quyết tối ưu với O(n) thời gian. Bạn hãy bắt tay vào viết code và chú ý xử lý các edge case như mảng rỗng hoặc không tìm thấy kết quả nhé!';
    }

    const aiMessage: InterviewMessage = {
      interview_id: interviewId,
      sk: makeMessageSK(aiTimestamp, aiMsgId),
      entity_type: 'MESSAGE',
      sender: 'AI',
      content: aiContent,
      message_type: 'FEEDBACK',
      created_at: aiTimestamp,
    };
    await interviewRepository.addMessage(aiMessage);

    return { userMessage, aiMessage };
  }

  async saveCodeSnapshot(
    interviewId: string,
    input: Omit<CreateCodeSnapshotInput, 'interview_id'>
  ): Promise<CodeSnapshot> {
    const now = new Date().toISOString();
    const snapshot: CodeSnapshot = {
      interview_id: interviewId,
      sk: makeCodeSnapshotSK(now),
      entity_type: 'CODE_SNAPSHOT',
      language: input.language,
      code: input.code,
      test_results: input.test_results,
      ai_code_review: input.ai_code_review || null,
      created_at: now,
    };

    await interviewRepository.saveCodeSnapshot(snapshot);
    return snapshot;
  }

  async completeAndEvaluateInterview(interviewId: string): Promise<AIEvaluation> {
    const context = await interviewRepository.getFullInterviewContext(interviewId);
    if (!context.session) {
      throw new Error('Interview session not found');
    }

    const evalId = `eval_${Date.now()}`;
    const now = new Date().toISOString();

    // Calculate score based on test results and conversation
    const latestSnapshot = context.snapshots[0];
    const passRatio = latestSnapshot && latestSnapshot.test_results.total > 0
      ? latestSnapshot.test_results.passed / latestSnapshot.test_results.total
      : 0.8;

    const codeQualityScore = Math.round(75 + passRatio * 15);
    const overallScore = Math.round((80 + codeQualityScore + 75 + 85 + 70) / 5);

    const evaluation: AIEvaluation = {
      interview_id: interviewId,
      sk: makeEvaluationSK(evalId),
      entity_type: 'EVALUATION',
      scores: {
        problem_solving: 80,
        code_quality: codeQualityScore,
        communication: 75,
        time_management: 85,
        optimization: 70,
      },
      overall_score: overallScore,
      strengths: [
        'Nắm vững kiến trúc dữ liệu và giải thuật cơ bản',
        'Giao tiếp rõ ràng, biết nhận diện điểm nghẽn độ phức tạp thuật toán',
        'Hoàn thành đầy đủ các test cases mẫu',
      ],
      weaknesses: [
        'Cần chủ động phân tích các corner/edge cases trước khi code',
        'Có thể mở rộng thêm kiểm thử với input kích thước lớn',
      ],
      suggestions: [
        'Rèn luyện thêm kỹ năng phân tích trade-off giữa Time và Space complexity',
        'Tập thói quen giải thích code trong quá trình gõ',
      ],
      hire_recommendation: overallScore >= 75 ? 'LEAN_YES' : 'LEAN_NO',
      created_at: now,
    };

    // 1. Save evaluation report to DynamoDB
    await interviewRepository.saveEvaluation(evaluation);

    // 2. Mark session as COMPLETED in DynamoDB
    await interviewRepository.updateSessionStatus(interviewId, 'COMPLETED', overallScore, now);

    // 3. Update candidate profile in MySQL
    if (context.session.user_id) {
      const numUserId = parseInt(context.session.user_id, 10);
      if (!isNaN(numUserId)) {
        await userRepository.recordInterviewResult(numUserId, overallScore);
      }
    }

    return evaluation;
  }

  async getInterviewDetails(interviewId: string) {
    return interviewRepository.getFullInterviewContext(interviewId);
  }

  async getUserInterviews(userId: string) {
    return interviewRepository.listByUser(userId);
  }
}

export const interviewService = new InterviewService();
