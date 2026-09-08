import { describe, expect, it } from "vitest";

import {
  clampProjectSidebarWidth,
  formatSidebarTime,
  PROJECT_SIDEBAR_WIDTH_DEFAULT,
  PROJECT_SIDEBAR_WIDTH_MAX,
  PROJECT_SIDEBAR_WIDTH_MIN,
} from "../src/renderer/project-sidebar-layout.js";

describe("project sidebar layout", () => {
  it("keeps the persisted width within a usable desktop range", () => {
    expect(PROJECT_SIDEBAR_WIDTH_DEFAULT).toBe(260);
    expect(clampProjectSidebarWidth(120)).toBe(PROJECT_SIDEBAR_WIDTH_MIN);
    expect(clampProjectSidebarWidth(318.6)).toBe(319);
    expect(clampProjectSidebarWidth(900)).toBe(PROJECT_SIDEBAR_WIDTH_MAX);
  });

  it("shows relative conversation activity across minute, hour and day boundaries", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    const label = (age: number, locale = "en") =>
      formatSidebarTime(new Date(now - age).toISOString(), now, locale);
    expect(label(0)).toBe("now");
    expect(label(-60_000)).toBe("now");
    expect(label(59_000)).toBe("now");
    expect(label(60_000)).toBe("1 minute ago");
    expect(label(3_600_000)).toBe("1 hour ago");
    expect(label(86_400_000)).toBe("yesterday");
    expect(label(2 * 86_400_000, "zh-CN")).toBe("2 天前");
    expect(label(7 * 86_400_000)).toBe("Sep 1");
    expect(formatSidebarTime("invalid", now, "en")).toBe("");
  });
});
