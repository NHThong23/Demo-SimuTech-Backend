import { describe, it, expect } from "vitest";
import { SessionManager, TooManySessionsError } from "./session-manager";
import { FakeClock } from "./clock";
import type { Problem } from "../domain/types";

const PROBLEM: Problem = {
  problem_id: "prob_1", title: "t", description: "d", difficulty: "EASY", category: "Array",
  starter_code: "", test_cases: [],
};

describe("SessionManager", () => {
  it("tạo và lấy lại được session theo id", () => {
    const mgr = new SessionManager({ maxConcurrent: 2 });
    const s = mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    expect(mgr.get("s1")).toBe(s);
  });

  it("ném TooManySessionsError khi vượt maxConcurrent", () => {
    const mgr = new SessionManager({ maxConcurrent: 1 });
    mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    expect(() =>
      mgr.create({ sessionId: "s2", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() }),
    ).toThrow(TooManySessionsError);
  });

  it("session đã completed không tính vào giới hạn đồng thời", () => {
    const mgr = new SessionManager({ maxConcurrent: 1 });
    const s1 = mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    s1.status = "completed";
    expect(() =>
      mgr.create({ sessionId: "s2", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() }),
    ).not.toThrow();
  });

  it("remove() xóa session khỏi manager", () => {
    const mgr = new SessionManager({ maxConcurrent: 2 });
    mgr.create({ sessionId: "s1", tokenHash: "h", problem: PROBLEM, language: "python", clock: new FakeClock() });
    mgr.remove("s1");
    expect(mgr.get("s1")).toBeUndefined();
  });
});
