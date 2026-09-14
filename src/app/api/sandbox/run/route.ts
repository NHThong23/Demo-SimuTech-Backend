import { NextRequest, NextResponse } from 'next/server';
import { problemRepository } from '@/repositories/problem.repository';
import { pistonService } from '@/services/piston.service';
import { apiError } from '@/lib/api-response';

/**
 * POST /api/sandbox/run
 * Chạy thử code với SAMPLE test cases (chỉ test cases công khai).
 * Dùng cho nút "Run Code" — ứng viên kiểm tra code trước khi submit.
 *
 * Flow: Nhận sourceCode → Lấy sample test cases từ DynamoDB → Gửi sang Piston → So sánh output → Trả kết quả
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { problemId, sourceCode, language } = body;

    // Validate input
    if (!sourceCode || !language) {
      return apiError('sourceCode và language là bắt buộc', 400, 'MISSING_FIELDS');
    }

    // Lấy test cases từ DynamoDB (chỉ sample)
    let testCases: Array<{ id: string | number; input: string; output: string }>;

    if (problemId) {
      const problem = await problemRepository.findById(problemId);
      if (problem && problem.test_cases) {
        // Chỉ lấy sample test cases (is_sample: true) cho "Run"
        const sampleCases = problem.test_cases.filter(
          (tc: { is_sample?: boolean }) => tc.is_sample === true
        );
        testCases = sampleCases.length > 0 ? sampleCases : problem.test_cases.slice(0, 2);
      } else {
        // Fallback nếu không tìm thấy problem
        testCases = [
          { id: 1, input: '[2,7,11,15]\n9', output: '[0,1]' },
          { id: 2, input: '[3,2,4]\n6', output: '[1,2]' },
        ];
      }
    } else {
      // Không có problemId → chạy code đơn thuần (không so sánh output)
      const execResult = await pistonService.executeCode(language, sourceCode);
      return NextResponse.json({
        status: execResult.success ? 'success' : 'error',
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        compileError: execResult.compileError,
        executionTimeMs: execResult.executionTimeMs,
        totalTestCases: 0,
        passedCount: 0,
        results: [],
      });
    }

    // Chạy code với từng test case qua Piston
    const { status, results, totalExecutionTimeMs } = await pistonService.runWithTestCases(
      language,
      sourceCode,
      testCases
    );

    const passedCount = results.filter((r) => r.passed).length;
    const maxMemoryUsageKb = 0; // Piston không trả memory info, để 0

    const response = {
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
      stdout: results.length > 0
        ? (results[0].passed
          ? `Passed ${passedCount}/${results.length} test cases.`
          : results[0].error || `Wrong answer on test case ${results[0].testCaseId}`)
        : 'No test cases found.',
      totalExecutionTimeMs,
      maxMemoryUsageKb,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Run code failed';
    return apiError(message, 400, 'RUN_CODE_FAILED');
  }
}
