import { describe, expect, it } from "vitest";

import { formatWorkedDuration } from "../src/renderer/turn-timeline.js";

describe("formatWorkedDuration", () => {
  it("formats seconds, minutes, and hours without depending on a live timer", () => {
    expect(formatWorkedDuration(28_999)).toBe("28s");
    expect(formatWorkedDuration(808_000)).toBe("13m 28s");
    expect(formatWorkedDuration(8_008_000)).toBe("2h 13m 28s");
  });
});
