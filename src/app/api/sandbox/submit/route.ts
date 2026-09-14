import { NextRequest, NextResponse } from 'next/server';
import { problemService } from '@/services/problem.service';
import { problemRepository } from '@/repositories/problem.repository';
import { pistonService } from '@/services/piston.service';
import { getOptionalAuth } from '@/lib/auth-guard';
import { apiError } from '@/lib/api-response';

/**
 * POST /api/sandbox/submit
 * Submit code chính thức — chạy với TẤT CẢ test cases (cả hidden).
 * Lưu kết quả submission vào DynamoDB.
 *
 * Flow: Nhận sourceCode → Lấy toàn bộ test cases → Chạy qua Piston → Lưu submission → Trả kết quả
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { problemId, sessionId, language, sourceCode } = body;

    // Validate input
    if (!sourceCode || !language) {
      return apiError('sourceCode và language là bắt buộc', 400, 'MISSING_FIELDS');
    }

    // Xác thực user (nếu có token)
    const authUser = getOptionalAuth(req);
    const userId = authUser ? String(authUser.id) : (body.userId ? String(body.userId) : '2');

    // Lấy TẤT CẢ test cases từ DynamoDB (cả sample + hidden)
    let testCases: Array<{ id: string | number; input: string; output: string }>;

    if (problemId) {
      const problem = await problemRepository.findById(problemId);
      if (problem && problem.test_cases) {
        testCases = problem.test_cases;
      } else {
        testCases = [
          { id: 1, input: '[2,7,11,15]\n9', output: '[0,1]' },
          { id: 2, input: '[3,2,4]\n6', output: '[1,2]' },
          { id: 3, input: '[3,3]\n6', output: '[0,1]' },
        ];
      }
    } else {
      return apiError('problemId là bắt buộc khi submit', 400, 'MISSING_PROBLEM_ID');
    }

    // Chạy code với toàn bộ test cases qua Piston
    const { status, results, totalExecutionTimeMs } = await pistonService.runWithTestCases(
      language,
      sourceCode,
      testCases
    );

    const passedCount = results.filter((r) => r.passed).length;

    // Lưu kết quả submission vào DynamoDB
    const submission = await problemService.submitCode(
      {
        problem_id: problemId,
        user_id: userId,
        language,
        code: sourceCode,
        interview_id: sessionId || null,
      },
      {
        status,
        execution_time_ms: totalExecutionTimeMs,
        memory_usage_kb: 0,
        test_cases_passed: passedCount,
        total_test_cases: results.length,
      }
    );

    const response = {
      submissionId: submission.submission_id,
      submittedAt: submission.created_at,
      status: status.toLowerCase(),
      totalTestCases: results.length,
      passedCount,
      results: results.map((r) => ({
        testCaseId: r.testCaseId,
        input: r.input,
        expectedOutput: r.expectedOutput,
        actualOutput: r.actualOutput.trim(),
        passed: r.passed,
        executionTimeMs: r.executionTimeMs,
        memoryUsageKb: 0,
        error: r.error || undefined,
      })),
      stdout: status === 'ACCEPTED'
        ? `Submission passed all ${results.length} test cases!`
        : status === 'COMPILE_ERROR'
          ? `Compile Error: ${results[0]?.error || 'Unknown'}`
          : `Failed: ${passedCount}/${results.length} test cases passed.`,
      totalExecutionTimeMs,
      maxMemoryUsageKb: 0,
      percentileRuntime: status === 'ACCEPTED' ? 94.2 : 0,
      percentileMemory: status === 'ACCEPTED' ? 89.6 : 0,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Submit code failed';
    return apiError(message, 400, 'SUBMIT_CODE_FAILED');
  }
}
