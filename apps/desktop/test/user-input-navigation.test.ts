import { describe, expect, it } from "vitest";

import {
  moveUserInputOptionFocus,
  moveUserInputQuestionFocus,
} from "../src/renderer/user-input-navigation.js";

describe("workflow choice keyboard navigation", () => {
  it("wraps through every choice with the arrow keys", () => {
    expect(moveUserInputOptionFocus(0, 4, "ArrowDown")).toBe(1);
    expect(moveUserInputOptionFocus(3, 4, "ArrowDown")).toBe(0);
    expect(moveUserInputOptionFocus(0, 4, "ArrowUp")).toBe(3);
    expect(moveUserInputOptionFocus(2, 4, "ArrowUp")).toBe(1);
  });

  it("supports jumping to the first and last choice", () => {
    expect(moveUserInputOptionFocus(2, 4, "Home")).toBe(0);
    expect(moveUserInputOptionFocus(1, 4, "End")).toBe(3);
    expect(moveUserInputOptionFocus(0, 0, "ArrowDown")).toBe(-1);
  });
});

describe("question keyboard navigation (D#76 PR10C)", () => {
  it("wraps through every question with the arrow keys", () => {
    expect(moveUserInputQuestionFocus(0, 3, "ArrowRight")).toBe(1);
    expect(moveUserInputQuestionFocus(2, 3, "ArrowRight")).toBe(0);
    expect(moveUserInputQuestionFocus(0, 3, "ArrowLeft")).toBe(2);
    expect(moveUserInputQuestionFocus(1, 3, "ArrowLeft")).toBe(0);
  });

  it("supports jumping to the first and last question", () => {
    expect(moveUserInputQuestionFocus(1, 3, "Home")).toBe(0);
    expect(moveUserInputQuestionFocus(0, 3, "End")).toBe(2);
  });

  it("fails closed without questions", () => {
    expect(moveUserInputQuestionFocus(0, 0, "ArrowRight")).toBe(-1);
    expect(moveUserInputQuestionFocus(0, -1, "ArrowLeft")).toBe(-1);
  });
});
