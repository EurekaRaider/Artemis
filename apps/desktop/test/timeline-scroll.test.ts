import { describe, expect, it } from "vitest";

import {
  resolveTimelinePinned,
  resolveTimelineScrollTarget,
} from "../src/renderer/timeline-scroll.js";

describe("timeline auto-scroll", () => {
  it("stays pinned when a workspace panel reflow moves the bottom", () => {
    expect(
      resolveTimelinePinned({
        clientHeight: 600,
        pinned: true,
        scrollHeight: 1_600,
        scrollTop: 800,
        userInitiated: false,
      }),
    ).toBe(true);
  });

  it("stops following when the user deliberately scrolls away", () => {
    expect(
      resolveTimelinePinned({
        clientHeight: 600,
        pinned: true,
        scrollHeight: 1_600,
        scrollTop: 800,
        userInitiated: true,
      }),
    ).toBe(false);
  });

  it("resumes following after the user returns to the bottom", () => {
    expect(
      resolveTimelinePinned({
        clientHeight: 600,
        pinned: false,
        scrollHeight: 1_600,
        scrollTop: 950,
        userInitiated: true,
      }),
    ).toBe(true);
  });

  it("returns a pinned conversation to the latest content", () => {
    expect(
      resolveTimelineScrollTarget({
        clientHeight: 600,
        scrollHeight: 1_600,
        snapshot: { pinned: true, scrollTop: 800 },
      }),
    ).toBe(1_600);
  });

  it("restores and bounds an unpinned conversation position", () => {
    expect(
      resolveTimelineScrollTarget({
        clientHeight: 600,
        scrollHeight: 1_600,
        snapshot: { pinned: false, scrollTop: 700 },
      }),
    ).toBe(700);
    expect(
      resolveTimelineScrollTarget({
        clientHeight: 600,
        scrollHeight: 1_000,
        snapshot: { pinned: false, scrollTop: 700 },
      }),
    ).toBe(400);
  });
});
