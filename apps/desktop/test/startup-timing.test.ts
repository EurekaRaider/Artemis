import { describe, expect, it } from "vitest";

import { createStartupTiming } from "../src/main/startup-timing.js";

describe("startup timing", () => {
  it("records stable total and phase durations", () => {
    const readings = [100, 112.34, 145.67];
    const timing = createStartupTiming(() => readings.shift() ?? 145.67);

    expect(timing.mark("app-ready")).toEqual({
      stage: "app-ready",
      elapsedMs: 12.3,
      deltaMs: 12.3,
    });
    expect(timing.mark("window-created")).toEqual({
      stage: "window-created",
      elapsedMs: 45.7,
      deltaMs: 33.3,
    });
  });
});
