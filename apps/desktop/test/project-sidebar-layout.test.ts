import { describe, expect, it } from "vitest";

import {
  clampProjectSidebarWidth,
  PROJECT_SIDEBAR_WIDTH_DEFAULT,
  PROJECT_SIDEBAR_WIDTH_MAX,
  PROJECT_SIDEBAR_WIDTH_MIN,
} from "../src/renderer/project-sidebar-layout.js";

describe("project sidebar layout", () => {
  it("keeps the persisted width within a usable desktop range", () => {
    expect(PROJECT_SIDEBAR_WIDTH_DEFAULT).toBe(252);
    expect(clampProjectSidebarWidth(120)).toBe(PROJECT_SIDEBAR_WIDTH_MIN);
    expect(clampProjectSidebarWidth(318.6)).toBe(319);
    expect(clampProjectSidebarWidth(900)).toBe(PROJECT_SIDEBAR_WIDTH_MAX);
  });
});
