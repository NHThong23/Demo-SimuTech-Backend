import type { ChatMessage } from "../agents/types";
import type { TriggerType } from "../domain/types";
import type { SessionSnapshot } from "../session/session";
import type { TriggerPayload } from "../router/event-router";

const STAGE_GUIDE: Record<number, string> = {
  1: "Chặng này bạn cố tình trình bày đề THIẾU ràng buộc. Chỉ tiết lộ đúng 1 mục hidden_constraints khi ứng viên hỏi trúng ý đó, hoặc khi họ tự đặt giả định cần bạn xác nhận. Đừng tự ý tiết lộ hết.",
  2: "Đồng thuận nếu giải thuật hợp lý; phản biện nếu giải thuật chậm hoặc Big-O sai.",
  3: "Mặc định trả action=listen, chỉ quan sát. Chỉ action=speak để gợi mở khi trigger là silence hoặc time_warning.",
  4: "Yêu cầu ứng viên tự nghĩ test case. Nếu họ nói đã ổn nhưng test ẩn vẫn còn fail, đưa ra ĐÚNG một test case đang fail làm phản chứng — không tự bịa test khác.",
  5: "Hỏi theo follow_up_topics; hết chủ đề thì tự đặt câu hỏi sâu hơn về mở rộng hệ thống. Đọc sơ đồ whiteboard nếu có.",
  6: "Trả lời câu hỏi ngược của ứng viên. Khi họ bấm kết thúc, action=end.",
};

function formatList(items: string[] | undefined, revealedOrCovered: number[]): string {
  if (!items || items.length === 0) return "(không có, tự suy ra từ mô tả đề nếu cần)";
  return items
    .map((text, i) => `${i}. ${revealedOrCovered.includes(i) ? "[đã tiết lộ] " : ""}${text}`)
    .join("\n");
}

function buildSystemMessage(session: SessionSnapshot): string {
  const { problem, stageConfig, currentStage, stageElapsedSec } = session;
  const parts = [
    "Bạn là một Tech Lead đang phỏng vấn thử một ứng viên, nói tiếng Việt, ngắn gọn, không đưa lời giải trực tiếp.",
    `Đề bài: ${problem.title}\n${problem.description}`,
    `Ràng buộc ẩn (chỉ bạn biết):\n${formatList(problem.hidden_constraints, session.revealedConstraints)}`,
    `Chủ đề mở rộng (chỉ bạn biết):\n${formatList(problem.follow_up_topics, session.coveredTopics)}`,
    `Chặng hiện tại: ${currentStage}. ${stageConfig.name} (đã dùng ${stageElapsedSec}s / tối thiểu ${stageConfig.minSec}s / tối đa ${stageConfig.maxSec}s).`,
    STAGE_GUIDE[currentStage] ?? "",
    `Code hiện tại:\n${session.latestCode || "(chưa có)"}`,
  ];
  if (currentStage === 4) {
    parts.push(`Test ẩn: pass ${session.hiddenTestsPassed}/${session.hiddenTestsTotal}.`);
  }
  if (session.latestBoard) {
    parts.push(`Sơ đồ whiteboard: ${JSON.stringify(session.latestBoard)}`);
  }
  parts.push(
    'Luôn trả lời bằng đúng một JSON: {"action":"speak|listen|next_stage|end","reply":"...","note":"..."|null,"revealed_constraints":[chỉ số],"covered_topics":[chỉ số]}. Không thêm chữ nào ngoài JSON.',
  );
  return parts.join("\n\n");
}

function buildUserMessage(trigger: TriggerType, payload: TriggerPayload): string {
  switch (payload.kind) {
    case "utterance":
      return `[utterance] Ứng viên nói: "${payload.transcript}"`;
    case "code_result":
      return `[code_result] Kết quả chạy code: ${JSON.stringify(payload.result)}`;
    case "whiteboard_done":
      return "[whiteboard_done] Ứng viên vừa báo xong sơ đồ.";
    case "stage_enter":
      return "[stage_enter] Vừa chuyển sang chặng mới, hãy mở đầu chặng.";
    case "silence":
      return "[silence] Ứng viên im lặng quá lâu, không nói cũng không thao tác.";
    case "time_warning":
      return "[time_warning] Sắp hết thời gian tối đa của chặng này.";
    default:
      return `[${trigger}]`;
  }
}

export function buildPrompt(session: SessionSnapshot, trigger: TriggerType, payload: TriggerPayload): ChatMessage[] {
  return [
    { role: "system", content: buildSystemMessage(session) },
    { role: "user", content: buildUserMessage(trigger, payload) },
  ];
}
