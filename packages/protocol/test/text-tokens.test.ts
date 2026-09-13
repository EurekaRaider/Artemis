import { describe, expect, it } from "vitest";
import {
  estimateTextTokens,
  textWithinTokenBudget,
} from "../src/text-tokens.js";

describe("text token estimates", () => {
  it("distinguishes ASCII, Chinese and emoji tokens from UTF-8 storage bytes", () => {
    expect(estimateTextTokens("abcd".repeat(100))).toBe(100);
    expect(estimateTextTokens("中".repeat(100))).toBe(100);
    expect(estimateTextTokens("😀".repeat(100))).toBe(200);
    expect(estimateTextTokens("")).toBe(0);
  });

  it("returns resumable Unicode prefixes within a token budget", () => {
    const text = "abcd中文😀".repeat(100);
    let offset = 0;
    let restored = "";
    while (offset < text.length) {
      const chunk = textWithinTokenBudget(text.slice(offset), 11);
      expect(chunk.length).toBeGreaterThan(0);
      expect(estimateTextTokens(chunk)).toBeLessThanOrEqual(11);
      expect(chunk.isWellFormed()).toBe(true);
      restored += chunk;
      offset += chunk.length;
    }
    expect(restored).toBe(text);
    expect(textWithinTokenBudget(text, 0)).toBe("");
    expect(textWithinTokenBudget("😀", 1)).toBe("");
    expect(textWithinTokenBudget("head中文😀tail", 3, true)).toBe("😀tail");
    expect(textWithinTokenBudget("head😀", 1, true)).toBe("");
  });
});
