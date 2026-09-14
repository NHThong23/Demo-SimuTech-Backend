import { describe, it, expect } from "vitest";
import { ClientMessageSchema } from "./messages";

describe("ClientMessageSchema", () => {
  it("accepts speech.start with no data", () => {
    const r = ClientMessageSchema.safeParse({ type: "speech.start" });
    expect(r.success).toBe(true);
  });

  it("accepts editor.update with code + language", () => {
    const r = ClientMessageSchema.safeParse({
      type: "editor.update",
      data: { code: "def f(): pass", language: "python" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects editor.update with invalid language", () => {
    const r = ClientMessageSchema.safeParse({
      type: "editor.update",
      data: { code: "x", language: "rust" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects code larger than 64KB", () => {
    const r = ClientMessageSchema.safeParse({
      type: "editor.update",
      data: { code: "a".repeat(65537), language: "python" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts code.run without data", () => {
    const r = ClientMessageSchema.safeParse({ type: "code.run" });
    expect(r.success).toBe(true);
  });

  it("accepts code.run with customInput", () => {
    const r = ClientMessageSchema.safeParse({ type: "code.run", data: { customInput: "1 2" } });
    expect(r.success).toBe(true);
  });

  it("accepts whiteboard.update within node/edge limits", () => {
    const r = ClientMessageSchema.safeParse({
      type: "whiteboard.update",
      data: { nodes: [{ id: "n1", label: "a", x: 0, y: 0 }], edges: [] },
    });
    expect(r.success).toBe(true);
  });

  it("rejects whiteboard.update over 200 nodes", () => {
    const nodes = Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, label: "a", x: 0, y: 0 }));
    const r = ClientMessageSchema.safeParse({ type: "whiteboard.update", data: { nodes, edges: [] } });
    expect(r.success).toBe(false);
  });

  it("rejects unknown type", () => {
    const r = ClientMessageSchema.safeParse({ type: "not.a.type" });
    expect(r.success).toBe(false);
  });
});
