import { NextRequest, NextResponse } from 'next/server';
import { aiProvider } from '@/services/ai';
import { apiError } from '@/lib/api-response';

/**
 * POST /api/interview/sessions/:id/system-design/evaluate
 * Phân tích kiến trúc system design từ React Flow diagram.
 * Kết quả từ AI Provider (mock hoặc thực) trả về bottleneck analysis & feedback.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await props.params;
    const body = await req.json();
    const { scenarioTitle = 'System Design', requirementsPrompt = '', architecture } = body;

    if (!architecture || !Array.isArray(architecture.nodes)) {
      return apiError('Trường "architecture" với danh sách "nodes" là bắt buộc', 400, 'MISSING_ARCHITECTURE');
    }

    const result = await aiProvider.evaluateSystemDesign({
      sessionId,
      scenarioTitle,
      requirementsPrompt,
      architecture,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return apiError(err.message || 'Evaluate system design failed', 400, 'EVALUATION_FAILED');
  }
}
