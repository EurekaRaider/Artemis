import { describe, expect, it } from "vitest";

import { moveUserInputOptionFocus } from "../src/renderer/user-input-navigation.js";

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
