import { describe, it, expect, vi } from "vitest";
import { FakeClock } from "./clock";

describe("FakeClock", () => {
  it("now() bắt đầu từ 0 và tăng khi advance", () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(0);
    clock.advance(1000);
    expect(clock.now()).toBe(1000);
  });

  it("fire timer đúng lúc khi advance đủ", () => {
    const clock = new FakeClock();
    const fn = vi.fn();
    clock.setTimeout(fn, 500);
    clock.advance(499);
    expect(fn).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("không fire timer đã bị clearTimeout", () => {
    const clock = new FakeClock();
    const fn = vi.fn();
    const t = clock.setTimeout(fn, 500);
    clock.clearTimeout(t);
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("timer đặt ra trong lúc đang fire timer khác vẫn được chạy nếu tới hạn cùng lượt advance", () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimeout(() => {
      order.push("first");
      clock.setTimeout(() => order.push("second"), 0);
    }, 100);
    clock.advance(100);
    expect(order).toEqual(["first", "second"]);
  });
});
