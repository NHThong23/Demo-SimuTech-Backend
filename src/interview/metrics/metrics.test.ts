import { describe, it, expect } from "vitest";
import { MetricsCollector } from "./metrics";

describe("MetricsCollector", () => {
  it("summary() trả null cho mọi chỉ số khi chưa có sample nào", () => {
    const m = new MetricsCollector();
    const s = m.summary();
    expect(s.llm).toBeNull();
    expect(s.jsonValidRate).toBeNull();
  });

  it("tính median và p95 đúng từ các sample llmMs", () => {
    const m = new MetricsCollector();
    for (const ms of [100, 200, 300, 400, 500]) m.recordTurnLatency({ llmMs: ms });
    const s = m.summary();
    expect(s.llm).toEqual({ median: 300, p95: 500 });
  });

  it("bỏ qua field không có mặt trong sample khi tính riêng từng chỉ số", () => {
    const m = new MetricsCollector();
    m.recordTurnLatency({ llmMs: 100 });
    m.recordTurnLatency({ sttMs: 50 });
    const s = m.summary();
    expect(s.llm).toEqual({ median: 100, p95: 100 });
    expect(s.stt).toEqual({ median: 50, p95: 50 });
  });

  it("đếm lỗi theo từng agent", () => {
    const m = new MetricsCollector();
    m.recordError("llm");
    m.recordError("llm");
    m.recordError("tts");
    expect(m.summary().errorCounts).toEqual({ llm: 2, tts: 1 });
  });

  it("tính tỷ lệ JSON hợp lệ", () => {
    const m = new MetricsCollector();
    m.recordJsonOutcome(true);
    m.recordJsonOutcome(true);
    m.recordJsonOutcome(false);
    expect(m.summary().jsonValidRate).toBeCloseTo(2 / 3);
  });
});
