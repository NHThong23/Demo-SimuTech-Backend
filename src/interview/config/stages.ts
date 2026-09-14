import type { Stage, StageConfig } from "../domain/types";

export const STAGE_CONFIG: StageConfig[] = [
  { index: 1, name: "Làm rõ yêu cầu", minSec: 180, maxSec: 300, silenceThresholdSec: 10, channels: ["voice"] },
  { index: 2, name: "Thảo luận giải thuật", minSec: 300, maxSec: 600, silenceThresholdSec: 20, channels: ["voice", "whiteboard"] },
  { index: 3, name: "Viết mã", minSec: 900, maxSec: 1500, silenceThresholdSec: 45, channels: ["voice", "editor"] },
  { index: 4, name: "Tự kiểm thử & gỡ lỗi", minSec: 300, maxSec: 600, silenceThresholdSec: 20, channels: ["voice", "editor"] },
  { index: 5, name: "Mở rộng & phản biện", minSec: 300, maxSec: 600, silenceThresholdSec: 20, channels: ["voice", "whiteboard"] },
  { index: 6, name: "Đánh giá & wrap-up", minSec: 0, maxSec: 300, silenceThresholdSec: 10, channels: ["voice"] },
];

export function getStageConfig(stage: Stage): StageConfig {
  const config = STAGE_CONFIG.find((s) => s.index === stage);
  if (!config) throw new Error(`Unknown stage: ${stage}`);
  return config;
}
