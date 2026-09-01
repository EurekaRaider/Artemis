import { describe, expect, it } from "vitest";

import { splitMessageBytes, utf8ByteLength } from "../src/split.js";

describe("splitMessageBytes（证据 E13，#757 教训）", () => {
  it("短文本不切分", () => {
    expect(splitMessageBytes("hello", 28000)).toEqual(["hello"]);
  });

  it("emoji 不碎码点（surrogate pair 完整）", () => {
    // 每个 emoji 4 字节；maxBytes=10 → 每段最多 2 个 emoji
    const text = "😀😀😀😀😀"; // 5 × 4B = 20B
    const chunks = splitMessageBytes(text, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(utf8ByteLength(c)).toBeLessThanOrEqual(10);
      // 每段必须是完整码点序列
      expect([...c].every((ch) => ch === "😀")).toBe(true);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("中文混排不碎码点", () => {
    const text = "你好世界".repeat(10); // 40 字 × 3B = 120B
    const chunks = splitMessageBytes(text, 50);
    for (const c of chunks) {
      expect(utf8ByteLength(c)).toBeLessThanOrEqual(50);
      // 不产出孤立代理项（会抛错或产生替换字符）
      expect(c.includes("\uFFFD")).toBe(false);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("28000 个 CJK 字符（≈84KB）切成 ≥3 段（#757 回归）", () => {
    const text = "汉".repeat(28000); // 84000 字节
    const chunks = splitMessageBytes(text, 28000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect(utf8ByteLength(c)).toBeLessThanOrEqual(28000);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("优先在换行边界切断", () => {
    const text = `${"a".repeat(60)}\n${"b".repeat(60)}`;
    const chunks = splitMessageBytes(text, 70);
    expect(chunks[0]).toBe(`${"a".repeat(60)}\n`);
  });

  it("maxBytes ≤0 抛错", () => {
    expect(() => splitMessageBytes("x", 0)).toThrow(RangeError);
  });
});
