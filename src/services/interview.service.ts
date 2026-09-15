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
import { aiProvider } from '@/services/ai';

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
      ai_model: input.ai_model || process.env.AI_PROVIDER || 'mock',
      duration_seconds: 0,
      overall_score: null,
      started_at: now,
      completed_at: null,
    };

    await interviewRepository.createSession(session);

    // 2. Tạo lời chào mở đầu từ AI Provider
    const greetingContent = await aiProvider.generateGreeting({
      problemTitle,
      interviewType: session.interview_type,
    });

    const msgId = `msg_${Date.now()}`;
    const greetingTime = new Date().toISOString();
    const initialMessage: InterviewMessage = {
      interview_id: interviewId,
      sk: makeMessageSK(greetingTime, msgId),
      entity_type: 'MESSAGE',
      sender: 'AI',
      content: greetingContent,
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

    // 1. Lưu tin nhắn của ứng viên
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

    // 2. Lấy context phiên phỏng vấn để gửi cho AI
    const context = await interviewRepository.getFullInterviewContext(interviewId);
    const problem = context.session?.problem_id
      ? await problemRepository.findById(context.session.problem_id)
      : null;

    // 3. Tạo phản hồi từ AI Provider (dễ swap sang model thật sau này)
    const { content: aiContent, messageType } = await aiProvider.generateInterviewResponse({
      conversationHistory: context.messages.map((m) => ({
        sender: m.sender,
        content: m.content,
      })),
      problemContext: {
        title: problem?.title ?? 'Unknown Problem',
        description: problem?.description ?? '',
        difficulty: problem?.difficulty ?? 'EASY',
        category: problem?.category ?? 'General',
      },
      userMessage: content,
    });

    const aiTimestamp = new Date().toISOString();
    const aiMsgId = `msg_${Date.now() + 1}`;
    const aiMessage: InterviewMessage = {
      interview_id: interviewId,
      sk: makeMessageSK(aiTimestamp, aiMsgId),
      entity_type: 'MESSAGE',
      sender: 'AI',
      content: aiContent,
      message_type: messageType,
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

    // Lấy thông tin problem để AI review code có context
    const context = await interviewRepository.getFullInterviewContext(interviewId);
    const problem = context.session?.problem_id
      ? await problemRepository.findById(context.session.problem_id)
      : null;

    // Gọi AI review code (nếu chưa có review từ client)
    let aiReview = input.ai_code_review ?? null;
    if (!aiReview && input.code) {
      try {
        aiReview = await aiProvider.reviewCode({
          code: input.code,
          language: input.language,
          problemTitle: problem?.title ?? 'Unknown',
          problemDescription: problem?.description ?? '',
        });
      } catch {
        // Review thất bại không nên block việc lưu snapshot
        aiReview = null;
      }
    }

    const snapshot: CodeSnapshot = {
      interview_id: interviewId,
      sk: makeCodeSnapshotSK(now),
      entity_type: 'CODE_SNAPSHOT',
      language: input.language,
      code: input.code,
      test_results: input.test_results,
      ai_code_review: aiReview,
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

    // Gọi AI Provider để chấm điểm dựa trên toàn bộ context
    const evaluationResult = await aiProvider.evaluateInterview({
      session: context.session,
      messages: context.messages,
      codeSnapshots: context.snapshots,
    });

    const evaluation: AIEvaluation = {
      interview_id: interviewId,
      sk: makeEvaluationSK(evalId),
      entity_type: 'EVALUATION',
      scores: evaluationResult.scores,
      overall_score: evaluationResult.overall_score,
      strengths: evaluationResult.strengths,
      weaknesses: evaluationResult.weaknesses,
      suggestions: evaluationResult.suggestions,
      hire_recommendation: evaluationResult.hire_recommendation,
      created_at: now,
    };

    // 1. Lưu báo cáo đánh giá vào DynamoDB
    await interviewRepository.saveEvaluation(evaluation);

    // 2. Cập nhật trạng thái phiên phỏng vấn
    await interviewRepository.updateSessionStatus(
      interviewId,
      'COMPLETED',
      evaluationResult.overall_score,
      now
    );

    // 3. Cập nhật thống kê ứng viên trong MySQL
    if (context.session.user_id) {
      const numUserId = parseInt(context.session.user_id, 10);
      if (!isNaN(numUserId)) {
        await userRepository.recordInterviewResult(numUserId, evaluationResult.overall_score);
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
