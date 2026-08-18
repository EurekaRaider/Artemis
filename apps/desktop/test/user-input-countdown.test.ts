import { describe, expect, it } from "vitest";

import { formatUserInputCountdown } from "../src/renderer/user-input-countdown.js";

describe("user input countdown", () => {
  it("formats the remaining duration as a stable header countdown", () => {
    expect(formatUserInputCountdown(5 * 60_000)).toBe("5:00");
    expect(formatUserInputCountdown(61_001)).toBe("1:02");
    expect(formatUserInputCountdown(-1)).toBe("0:00");
  });
});
