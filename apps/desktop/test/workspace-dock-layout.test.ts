import { describe, expect, it } from "vitest";

import {
  clampWorkspaceDockWidth,
  workspaceDockWidthAfterKey,
  workspaceDockWidthAfterPointer,
  workspaceDockWidthBounds,
} from "../src/renderer/workspace-dock-layout.js";

describe("workspace dock layout", () => {
  it("preserves responsive minimums while reserving conversation space", () => {
    expect(workspaceDockWidthBounds(1_400, 1_400)).toEqual({
      min: 440,
      max: 1_073,
    });
    expect(workspaceDockWidthBounds(900, 1_000)).toEqual({
      min: 380,
      max: 573,
    });
    expect(workspaceDockWidthBounds(700, 800)).toEqual({
      min: 320,
      max: 373,
    });
    expect(workspaceDockWidthBounds(1_213, 1_512, 328)).toEqual({
      min: 440,
      max: 558,
    });
  });

  it("clamps and rounds pointer and keyboard widths", () => {
    const bounds = { min: 380, max: 720 };
    expect(clampWorkspaceDockWidth(200, bounds)).toBe(380);
    expect(clampWorkspaceDockWidth(582.6, bounds)).toBe(583);
    expect(clampWorkspaceDockWidth(900, bounds)).toBe(720);
  });

  it("mirrors pointer and arrow resizing in RTL while preserving Home and End", () => {
    const bounds = { min: 380, max: 720 };
    expect(workspaceDockWidthAfterPointer(500, 700, 640, "ltr", bounds)).toBe(
      560,
    );
    expect(workspaceDockWidthAfterPointer(500, 700, 760, "rtl", bounds)).toBe(
      560,
    );
    expect(
      workspaceDockWidthAfterKey(500, "ArrowLeft", "ltr", bounds, 900, 24),
    ).toBe(524);
    expect(
      workspaceDockWidthAfterKey(500, "ArrowRight", "rtl", bounds, 900, 24),
    ).toBe(524);
    expect(
      workspaceDockWidthAfterKey(500, "ArrowRight", "ltr", bounds, 900, 24),
    ).toBe(476);
    expect(
      workspaceDockWidthAfterKey(500, "ArrowLeft", "rtl", bounds, 900, 24),
    ).toBe(476);
    expect(
      workspaceDockWidthAfterKey(500, "Home", "rtl", bounds, 900, 24),
    ).toBe(558);
    expect(workspaceDockWidthAfterKey(500, "End", "rtl", bounds, 900, 24)).toBe(
      720,
    );
  });
});
