import { describe, expect, it, vi } from "vitest";
import {
  applyWindowsWindowMaterial,
  windowsWindowMaterial,
} from "../../../src/main/appearance/windows-window-material.js";

const preferences = {
  release: "10.0.26200",
  dark: false,
  reducedTransparency: false,
  highContrast: false,
  forcedColors: false,
};

describe("Windows main-window material", () => {
  it.each(["10.0.22621", "10.0.26200"])("uses Acrylic on %s", (release) => {
    expect(windowsWindowMaterial({ ...preferences, release })).toBe("acrylic");
  });
  it.each(["10.0.19045", "10.0.22000", "invalid"])(
    "keeps an opaque host with web glass on %s",
    (release) => {
      const window = {
        setBackgroundMaterial: vi.fn(),
        setBackgroundColor: vi.fn(),
      };
      expect(
        applyWindowsWindowMaterial(window, { ...preferences, release }),
      ).toBe("web");
      expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
      expect(window.setBackgroundColor).toHaveBeenCalledWith("#f7f7f6");
    },
  );
  it.each(["reducedTransparency", "highContrast", "forcedColors"] as const)(
    "removes native and web glass for %s without changing motion",
    (preference) => {
      const window = {
        setBackgroundMaterial: vi.fn(),
        setBackgroundColor: vi.fn(),
      };
      expect(
        applyWindowsWindowMaterial(window, {
          ...preferences,
          [preference]: true,
        }),
      ).toBe("solid");
      expect(window.setBackgroundMaterial).toHaveBeenCalledWith("none");
      expect(window.setBackgroundColor).toHaveBeenCalledWith("#f7f7f6");
    },
  );
  it("restores Acrylic after a preference change and remains transparent in dark mode", () => {
    const window = {
      setBackgroundMaterial: vi.fn(),
      setBackgroundColor: vi.fn(),
    };
    applyWindowsWindowMaterial(window, {
      ...preferences,
      reducedTransparency: true,
    });
    expect(
      applyWindowsWindowMaterial(window, { ...preferences, dark: true }),
    ).toBe("acrylic");
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("acrylic");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#00000000");
  });
  it("falls back to an opaque dark host when the native API fails", () => {
    const window = {
      setBackgroundMaterial: vi.fn(() => {
        throw new Error("Unavailable");
      }),
      setBackgroundColor: vi.fn(),
    };
    expect(
      applyWindowsWindowMaterial(window, { ...preferences, dark: true }),
    ).toBe("web");
    expect(window.setBackgroundColor).toHaveBeenCalledWith("#0f1012");
  });
});
