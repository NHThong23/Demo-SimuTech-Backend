export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type Language = "python" | "javascript" | "cpp";
export type AiStatus = "idle" | "listening" | "transcribing" | "thinking" | "speaking";
export type SessionStatus = "active" | "completed" | "abandoned";
export type TriggerType = "utterance" | "code_result" | "whiteboard_done" | "stage_enter" | "silence" | "time_warning";
export type LlmAction = "speak" | "listen" | "next_stage" | "end";
export type ExecStatus = "OK" | "COMPILE_ERROR" | "RUNTIME_ERROR" | "TIME_LIMIT" | "EXECUTOR_UNAVAILABLE";

export interface StageConfig {
  index: Stage;
  name: string;
  minSec: number;
  maxSec: number;
  silenceThresholdSec: number;
  channels: Array<"voice" | "editor" | "whiteboard">;
}

export interface TestCase { id: number; input: string; output: string; is_sample: boolean; }

export interface Problem {
  problem_id: string;
  title: string;
  description: string;
  difficulty: string;
  category: string;
  starter_code: string;
  test_cases: TestCase[];
  hidden_constraints?: string[];
  follow_up_topics?: string[];
}

export interface WhiteboardNode { id: string; label: string; x: number; y: number; }
export interface WhiteboardEdge { from: string; to: string; label?: string; }
export interface WhiteboardState { nodes: WhiteboardNode[]; edges: WhiteboardEdge[]; }

export interface Turn {
  turnId: string;
  role: "user" | "ai";
  stage: Stage;
  trigger: TriggerType;
  text: string;
  action?: LlmAction;
  note?: string;
  interrupted: boolean;
  createdAt: string;
  latencyMs?: { stt?: number; llm?: number; ttsFirstAudio?: number; ttsTotal?: number };
  error?: string;
}

export interface LlmTurnOutput {
  action: LlmAction;
  reply: string;
  note: string | null;
  revealed_constraints: number[];
  covered_topics: number[];
}

export interface TestResultItem { id: number; passed: boolean; actual: string; expected: string; timeMs: number; }

export interface CodeRunResult {
  runId: string;
  mode: "sample" | "custom";
  status: ExecStatus;
  tests?: TestResultItem[];
  output?: { stdout: string; stderr: string; timeMs: number };
}

export interface EvaluationPillar { strengths: string[]; improvements: string[]; }
export interface EvaluationResult {
  pillars: {
    problem_solving: EvaluationPillar;
    code_quality: EvaluationPillar;
    testing_debugging: EvaluationPillar;
    communication: EvaluationPillar;
  } | null;
  objective: {
    hidden_tests_passed: number;
    hidden_tests_total: number;
    constraints_clarified: number;
    constraints_total: number;
    hints_given: number;
    code_runs: number;
    interruptions: number;
    stage_durations_sec: Record<string, number>;
    forced_transitions: Stage[];
  };
  summary: string;
}

export interface SessionMetaItem {
  session_id: string;
  sk: "META";
  problem_id: string;
  language: Language;
  user_id?: string;
  token_hash: string;
  status: SessionStatus;
  current_stage: Stage;
  started_at: string;
  ended_at?: string;
  model_versions: { qwen: string; stt: string; tts: string };
}
