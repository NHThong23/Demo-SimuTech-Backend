import { NextRequest, NextResponse } from 'next/server';
import { problemService } from '@/services/problem.service';
import { apiError } from '@/lib/api-response';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const { searchParams } = new URL(req.url);
    const isAdmin = searchParams.get('admin') === 'true';

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
