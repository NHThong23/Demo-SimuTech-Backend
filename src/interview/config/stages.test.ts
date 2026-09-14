import { describe, it, expect } from "vitest";
import { STAGE_CONFIG, getStageConfig } from "./stages";

describe("STAGE_CONFIG", () => {
  it("có đúng 6 chặng, đánh số 1..6 liên tục", () => {
    expect(STAGE_CONFIG.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("mọi ngưỡng im lặng nằm trong khoảng 5-45 giây", () => {
    for (const s of STAGE_CONFIG) {
      expect(s.silenceThresholdSec).toBeGreaterThanOrEqual(5);
      expect(s.silenceThresholdSec).toBeLessThanOrEqual(45);
    }
  });

  it("minSec luôn <= maxSec", () => {
    for (const s of STAGE_CONFIG) expect(s.minSec).toBeLessThanOrEqual(s.maxSec);
  });

  it("chặng 3 (viết mã) có ngưỡng im lặng 45s và kênh editor", () => {
    const s = getStageConfig(3);
    expect(s.silenceThresholdSec).toBe(45);
    expect(s.channels).toContain("editor");
  });

  it("chặng 5 có kênh whiteboard", () => {
    expect(getStageConfig(5).channels).toContain("whiteboard");
  });
});
