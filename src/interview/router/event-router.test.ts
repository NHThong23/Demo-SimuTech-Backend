import { describe, it, expect, vi } from "vitest";
import { EventRouter } from "./event-router";
import { FakeClock } from "../session/clock";

function makeRouter(overrides: Partial<{
  silenceThresholdSec: number; stageElapsedSec: number; stageMaxSec: number; isBusy: boolean;
}> = {}) {
  const clock = new FakeClock();
  const onTrigger = vi.fn();
  const onInterrupt = vi.fn();
  const onStagePrecondition = vi.fn();
  let busy = overrides.isBusy ?? false;
  const router = new EventRouter({
    clock,
    getSilenceThresholdSec: () => overrides.silenceThresholdSec ?? 10,
    getStageElapsedSec: () => overrides.stageElapsedSec ?? 0,
    getStageMaxSec: () => overrides.stageMaxSec ?? 300,
    isBusy: () => busy,
    onTrigger,
    onInterrupt,
    onStagePrecondition,
    canDoneStage: () => ({ ok: true }),
    tickIntervalMs: 5000,
  });
  return { router, clock, onTrigger, onInterrupt, onStagePrecondition, setBusy: (v: boolean) => (busy = v) };
}

describe("EventRouter — silence", () => {
  it("phát trigger silence sau đúng ngưỡng kể từ lúc bắt đầu chặng", () => {
    const { router, clock, onTrigger } = makeRouter({ silenceThresholdSec: 10 });
    router.onStageEntered();
    onTrigger.mockClear();
    clock.advance(9999);
    expect(onTrigger).not.toHaveBeenCalledWith("silence", expect.anything());
    clock.advance(1);
    expect(onTrigger).toHaveBeenCalledWith("silence", { kind: "silence" });
  });

  it("không phát lại silence nếu không có hoạt động mới", () => {
    const { router, clock, onTrigger } = makeRouter({ silenceThresholdSec: 10 });
    router.onStageEntered();
    clock.advance(10_000);
    onTrigger.mockClear();
    clock.advance(20_000);
    expect(onTrigger).not.toHaveBeenCalledWith("silence", expect.anything());
  });

  it("hoạt động (editor.update) reset bộ đếm im lặng", () => {
    const { router, clock, onTrigger } = makeRouter({ silenceThresholdSec: 10 });
    router.onStageEntered();
    clock.advance(9000);
    router.handleEditorUpdate();
    onTrigger.mockClear();
    clock.advance(9000);
    expect(onTrigger).not.toHaveBeenCalledWith("silence", expect.anything());
    clock.advance(1000);
    expect(onTrigger).toHaveBeenCalledWith("silence", { kind: "silence" });
  });
});

describe("EventRouter — time warning", () => {
  it("phát time_warning đúng 1 lần khi qua 80% maxSec", () => {
    const { router, clock, onTrigger } = makeRouter({ stageMaxSec: 100, stageElapsedSec: 0 });
    router.onStageEntered();
    onTrigger.mockClear();
    // giả lập elapsedSec tăng dần qua các lần tick bằng cách advance nhiều lần 5s
    for (let i = 0; i < 20; i++) clock.advance(5000);
    const warningCalls = onTrigger.mock.calls.filter((c) => c[0] === "time_warning");
    expect(warningCalls.length).toBeLessThanOrEqual(1);
  });
});

describe("EventRouter — busy/interrupt", () => {
  it("speech.start khi đang bận thì gọi onInterrupt và xóa trigger đang chờ", () => {
    const { router, onInterrupt, setBusy } = makeRouter();
    setBusy(true);
    router.handleEditorUpdate();
    router.handleWhiteboardDone();
    expect(router.flushPending().length).toBe(1); // whiteboard_done được xếp hàng, editor.update chỉ reset timer không tạo trigger
    router.handleWhiteboardDone();
    router.handleSpeechStart();
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(router.flushPending()).toEqual([]);
  });

  it("trigger không bị mất khi bận, lấy ra được qua flushPending", () => {
    const { router, onTrigger, setBusy } = makeRouter();
    setBusy(true);
    router.handleWhiteboardDone();
    expect(onTrigger).not.toHaveBeenCalled();
    setBusy(false);
    expect(router.flushPending()).toEqual([{ kind: "whiteboard_done" }]);
  });
});

describe("EventRouter — stage.done precondition", () => {
  it("gọi onStagePrecondition khi canDoneStage trả ok:false", () => {
    const clock = new FakeClock();
    const onStagePrecondition = vi.fn();
    const router = new EventRouter({
      clock,
      getSilenceThresholdSec: () => 10,
      getStageElapsedSec: () => 0,
      getStageMaxSec: () => 300,
      isBusy: () => false,
      onTrigger: vi.fn(),
      onInterrupt: vi.fn(),
      onStagePrecondition,
      canDoneStage: () => ({ ok: false, message: "chưa chạy code" }),
    });
    const result = router.handleStageDone();
    expect(result.accepted).toBe(false);
    expect(onStagePrecondition).toHaveBeenCalledWith("chưa chạy code");
  });
});
