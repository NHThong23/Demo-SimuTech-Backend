import { NextRequest, NextResponse } from 'next/server';
import { problemService } from '@/services/problem.service';
import { problemRepository } from '@/repositories/problem.repository';
import { requireAdmin, getOptionalAuth, AuthError } from '@/lib/auth-guard';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const { searchParams } = new URL(req.url);

    // If authenticated as ADMIN or admin query parameter passed, reveal hidden test cases
    const authUser = getOptionalAuth(req);
    const isAdmin = authUser?.role === 'ADMIN' || searchParams.get('admin') === 'true';

    const problem = await problemService.getProblemById(id, isAdmin);
    if (!problem) {
      return apiError(`Problem with id '${id}' not found`, 404, 'NOT_FOUND');
    }

    const sampleCases = 'sample_test_cases' in problem ? problem.sample_test_cases : problem.test_cases;
    const formattedProblem = {
      ...problem,
      id: problem.problem_id,
      slug: problem.problem_id,
      difficulty: problem.difficulty.toLowerCase(),
      descriptionMarkdown: problem.description,
      constraints: problem.constraints ? problem.constraints.split('\n') : [],
      examples: sampleCases.map((tc) => ({
        input: tc.input,
        output: tc.output,
      })),
      starterCodes: {
        python: problem.starter_code || 'def solution():\n    pass',
        javascript: 'function solution() {\n  // your code\n}',
        typescript: 'function solution(): void {\n  // your code\n}',
        cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n  return 0;\n}',
        java: 'public class Solution {\n  public static void main(String[] args) {}\n}',
        go: 'package main\n\nfunc main() {}',
      },
      sampleTestCases: sampleCases.map((tc) => ({
        id: String(tc.id),
        input: tc.input,
        expectedOutput: tc.output,
        isSample: tc.is_sample,
      })),
    };

    return NextResponse.json(formattedProblem);
  } catch (err: any) {
    return apiError(err.message || 'Failed to fetch problem', 500, 'FETCH_FAILED');
  }
}

/**
 * Update problem details (Admin only)
 */
export async function PUT(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(req);
    const { id } = await props.params;
    const body = await req.json();

    const updated = await problemRepository.updateProblem(id, body);
    if (!updated) {
      return apiError(`Problem with id '${id}' not found`, 404, 'NOT_FOUND');
    }

    return apiSuccess(updated);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status, err.code);
    }
    return apiError(err.message || 'Failed to update problem', 400, 'UPDATE_FAILED');
  }
}

/**
 * Delete problem (Admin only)
 */
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(req);
    const { id } = await props.params;

    await problemRepository.deleteProblem(id);
    return apiSuccess({ message: `Problem '${id}' has been deleted` });
  } catch (err: any) {
    if (err instanceof AuthError) {
      return apiError(err.message, err.status, err.code);
    }
    return apiError(err.message || 'Failed to delete problem', 400, 'DELETE_FAILED');
  }
}
