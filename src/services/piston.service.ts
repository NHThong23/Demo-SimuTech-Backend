// =============================================================================
// PISTON SERVICE — Client kết nối với Piston Code Execution Engine
// Cung cấp executeCode() để chạy code ứng viên trong sandbox cách ly
// =============================================================================

import { pistonConfig, LANGUAGE_MAP, type PistonLanguageConfig } from '@/config/piston';
import { type SubmissionStatus } from '@/entities/submission.entity';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Payload gửi đến Piston API v2 */
interface PistonExecuteRequest {
  language: string;
  version: string;
  files: Array<{ name?: string; content: string }>;
  stdin?: string;
  args?: string[];
  compile_timeout?: number;
  run_timeout?: number;
  compile_memory_limit?: number;
  run_memory_limit?: number;
}

/** Kết quả trả về từ Piston API v2 */
interface PistonExecuteResponse {
  language: string;
  version: string;
  run: {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
    output: string;
  };
  compile?: {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: string | null;
    output: string;
  };
}

/** Kết quả đã được chuẩn hóa từ Piston */
export interface CodeExecutionResult {
  /** true nếu code chạy thành công (exit code 0, không có lỗi compile) */
  success: boolean;
  /** stdout từ code execution */
  stdout: string;
  /** stderr từ code execution */
  stderr: string;
  /** Exit code (0 = thành công) */
  exitCode: number | null;
  /** Signal nếu process bị kill (SIGKILL = timeout) */
  signal: string | null;
  /** Lỗi compile nếu có (Java, C++...) */
  compileError: string | null;
  /** Thời gian thực thi (ms) — ước tính từ performance.now() */
  executionTimeMs: number;
}

/** Kết quả chạy 1 test case */
export interface TestCaseResult {
  testCaseId: string;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  passed: boolean;
  executionTimeMs: number;
  /** Lỗi nếu có (compile error, runtime error, timeout...) */
  error?: string;
}

// ─── Service Implementation ─────────────────────────────────────────────────

class PistonService {
  private readonly apiUrl: string;

  constructor() {
    this.apiUrl = pistonConfig.apiUrl;
  }

  /**
   * Resolve ngôn ngữ từ tên frontend sang Piston config.
   * Ném lỗi nếu ngôn ngữ không được hỗ trợ.
   */
  resolveLanguage(language: string): PistonLanguageConfig {
    const key = language.toLowerCase().trim();
    const config = LANGUAGE_MAP[key];
    if (!config) {
      const supported = [...new Set(Object.values(LANGUAGE_MAP).map((l) => l.pistonName))];
      throw new Error(
        `Ngôn ngữ "${language}" không được hỗ trợ. Các ngôn ngữ hiện có: ${supported.join(', ')}`
      );
    }
    return config;
  }

  /**
   * Thực thi code trên Piston Engine.
   * @param language - Tên ngôn ngữ (python, javascript, java, cpp, c...)
   * @param sourceCode - Mã nguồn cần thực thi
   * @param stdin - Input cho chương trình (truyền qua stdin)
   * @returns Kết quả thực thi đã chuẩn hóa
   */
  async executeCode(
    language: string,
    sourceCode: string,
    stdin?: string
  ): Promise<CodeExecutionResult> {
    const langConfig = this.resolveLanguage(language);
    const startTime = performance.now();

    const payload: PistonExecuteRequest = {
      language: langConfig.pistonName,
      version: langConfig.version,
      files: [
        {
          name: langConfig.defaultFileName,
          content: sourceCode,
        },
      ],
      stdin: stdin || '',
      compile_timeout: pistonConfig.timeout.compile,
      run_timeout: pistonConfig.timeout.run,
      compile_memory_limit: pistonConfig.memoryLimit.compile,
      run_memory_limit: pistonConfig.memoryLimit.run,
    };

    try {
      const response = await fetch(`${this.apiUrl}/api/v2/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000), // 30s HTTP timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          stdout: '',
          stderr: `Piston API error (${response.status}): ${errorText}`,
          exitCode: null,
          signal: null,
          compileError: null,
          executionTimeMs: Math.round(performance.now() - startTime),
        };
      }

      const result: PistonExecuteResponse = await response.json();
      const execTimeMs = Math.round(performance.now() - startTime);

      // Kiểm tra lỗi compile (Java, C++...)
      if (result.compile && result.compile.code !== 0 && result.compile.code !== null) {
        return {
          success: false,
          stdout: result.compile.stdout || '',
          stderr: result.compile.stderr || '',
          exitCode: result.compile.code,
          signal: result.compile.signal,
          compileError: result.compile.stderr || result.compile.output || 'Compilation failed',
          executionTimeMs: execTimeMs,
        };
      }

      // Kết quả chạy
      const isTimeout = result.run.signal === 'SIGKILL';
      return {
        success: result.run.code === 0 && !isTimeout,
        stdout: result.run.stdout || '',
        stderr: result.run.stderr || '',
        exitCode: result.run.code,
        signal: result.run.signal,
        compileError: null,
        executionTimeMs: execTimeMs,
      };
    } catch (err: unknown) {
      const execTimeMs = Math.round(performance.now() - startTime);
      const message =
        err instanceof Error ? err.message : 'Unknown error connecting to Piston';

      // Phân biệt timeout vs connection refused
      const isConnectionError =
        message.includes('ECONNREFUSED') || message.includes('fetch failed');

      return {
        success: false,
        stdout: '',
        stderr: isConnectionError
          ? `Không thể kết nối đến Piston Engine tại ${this.apiUrl}. Hãy chắc chắn đã chạy: docker compose up -d`
          : `Execution error: ${message}`,
        exitCode: null,
        signal: null,
        compileError: null,
        executionTimeMs: execTimeMs,
      };
    }
  }

  /**
   * Chạy code với một danh sách test cases, trả về kết quả chi tiết cho từng test case.
   * @param language - Tên ngôn ngữ
   * @param sourceCode - Mã nguồn
   * @param testCases - Danh sách test cases (id, input, expected output)
   * @returns Kết quả tổng hợp
   */
  async runWithTestCases(
    language: string,
    sourceCode: string,
    testCases: Array<{ id: string | number; input: string; output: string }>
  ): Promise<{
    status: SubmissionStatus;
    results: TestCaseResult[];
    totalExecutionTimeMs: number;
  }> {
    const results: TestCaseResult[] = [];
    let overallStatus: SubmissionStatus = 'ACCEPTED';
    let totalTime = 0;

    for (const tc of testCases) {
      const execResult = await this.executeCode(language, sourceCode, tc.input);
      totalTime += execResult.executionTimeMs;

      // Lỗi compile → dừng ngay, không cần chạy tiếp
      if (execResult.compileError) {
        overallStatus = 'COMPILE_ERROR';
        results.push({
          testCaseId: String(tc.id),
          input: tc.input,
          expectedOutput: tc.output,
          actualOutput: '',
          passed: false,
          executionTimeMs: execResult.executionTimeMs,
          error: execResult.compileError,
        });
        // Đánh dấu các test case còn lại là chưa chạy
        for (const remaining of testCases.slice(results.length)) {
          results.push({
            testCaseId: String(remaining.id),
            input: remaining.input,
            expectedOutput: remaining.output,
            actualOutput: '',
            passed: false,
            executionTimeMs: 0,
            error: 'Skipped due to compile error',
          });
        }
        break;
      }

      // Timeout (SIGKILL)
      if (execResult.signal === 'SIGKILL') {
        overallStatus = 'TIME_LIMIT_EXCEEDED';
        results.push({
          testCaseId: String(tc.id),
          input: tc.input,
          expectedOutput: tc.output,
          actualOutput: '',
          passed: false,
          executionTimeMs: execResult.executionTimeMs,
          error: 'Time Limit Exceeded',
        });
        continue;
      }

      // Runtime error (exit code !== 0)
      if (!execResult.success) {
        if (overallStatus === 'ACCEPTED') overallStatus = 'RUNTIME_ERROR';
        results.push({
          testCaseId: String(tc.id),
          input: tc.input,
          expectedOutput: tc.output,
          actualOutput: execResult.stderr || execResult.stdout,
          passed: false,
          executionTimeMs: execResult.executionTimeMs,
          error: execResult.stderr || 'Runtime Error',
        });
        continue;
      }

      // So sánh output (trim whitespace ở đầu/cuối)
      const actualOutput = execResult.stdout.trim();
      const expectedOutput = tc.output.trim();
      const passed = actualOutput === expectedOutput;

      if (!passed && overallStatus === 'ACCEPTED') {
        overallStatus = 'WRONG_ANSWER';
      }

      results.push({
        testCaseId: String(tc.id),
        input: tc.input,
        expectedOutput: tc.output,
        actualOutput: execResult.stdout,
        passed,
        executionTimeMs: execResult.executionTimeMs,
      });
    }

    return { status: overallStatus, results, totalExecutionTimeMs: totalTime };
  }

  /**
   * Kiểm tra Piston Engine có đang hoạt động không.
   * @returns true nếu Piston sẵn sàng
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/api/v2/runtimes`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Lấy danh sách runtime đã cài đặt trên Piston.
   */
  async listRuntimes(): Promise<Array<{ language: string; version: string; aliases: string[] }>> {
    const res = await fetch(`${this.apiUrl}/api/v2/runtimes`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error('Failed to fetch Piston runtimes');
    return res.json();
  }
}

// Singleton export
export const pistonService = new PistonService();
