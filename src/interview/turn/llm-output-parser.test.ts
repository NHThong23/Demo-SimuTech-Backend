import { describe, it, expect } from "vitest";
import { parseLlmOutput } from "./llm-output-parser";

describe("parseLlmOutput", () => {
  it("parse đúng JSON hợp lệ", () => {
    const raw = '{"action":"speak","reply":"chào bạn","note":null,"revealed_constraints":[0],"covered_topics":[]}';
    const result = parseLlmOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.action).toBe("speak");
      expect(result.value.reply).toBe("chào bạn");
    }
  });

  it("bóc tách được JSON dù model bọc thêm markdown fence", () => {
    const raw = '```json\n{"action":"listen","reply":"","note":null,"revealed_constraints":[],"covered_topics":[]}\n```';
    const result = parseLlmOutput(raw);
    expect(result.ok).toBe(true);
  });

  it("báo lỗi khi không tìm thấy khối JSON nào", () => {
    const result = parseLlmOutput("mình không chắc nữa");
    expect(result).toEqual({ ok: false, error: "NO_JSON_FOUND" });
  });

  it("báo lỗi khi JSON.parse thất bại", () => {
    const result = parseLlmOutput("{action: speak}"); // thiếu dấu ngoặc kép
    expect(result.ok).toBe(false);
  });

  it("báo lỗi khi thiếu field bắt buộc action", () => {
    const result = parseLlmOutput('{"reply":"hi","note":null,"revealed_constraints":[],"covered_topics":[]}');
    expect(result).toEqual({ ok: false, error: "SCHEMA_MISMATCH" });
  });

  it("báo lỗi khi action không thuộc enum hợp lệ", () => {
    const result = parseLlmOutput('{"action":"shout","reply":"","note":null,"revealed_constraints":[],"covered_topics":[]}');
    expect(result.ok).toBe(false);
  });

  it("mặc định revealed_constraints/covered_topics thành mảng rỗng nếu thiếu", () => {
    const result = parseLlmOutput('{"action":"listen","reply":"","note":null}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revealed_constraints).toEqual([]);
      expect(result.value.covered_topics).toEqual([]);
    }
  });

  it("coi revealed_constraints/covered_topics=null như mảng rỗng (model thật qua Ollama hay trả null thay vì [])", () => {
    const result = parseLlmOutput('{"action":"speak","reply":"ok","note":null,"revealed_constraints":null,"covered_topics":null}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.revealed_constraints).toEqual([]);
      expect(result.value.covered_topics).toEqual([]);
    }
  });
});
