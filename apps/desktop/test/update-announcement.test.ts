import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { claimUpdateAnnouncement } from "../src/renderer/update-announcement.js";

const values = new Map<string, string>();
const storage = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    values.set(key, value);
  }),
};
beforeEach(() => {
  values.clear();
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

it("does not replay a completed update after the renderer is recreated", async () => {
  expect(claimUpdateAnnouncement("1.6.6")).toBe(true);
  vi.resetModules();
  const reopened = await import("../src/renderer/update-announcement.js");
  expect(reopened.claimUpdateAnnouncement("1.6.6")).toBe(false);
  expect(reopened.claimUpdateAnnouncement("1.6.7")).toBe(true);
  expect(reopened.claimUpdateAnnouncement("1.6.7")).toBe(false);
});

it("does not block startup when local storage is unavailable", () => {
  storage.getItem.mockImplementationOnce(() => {
    throw new DOMException("Storage unavailable", "SecurityError");
  });
  expect(claimUpdateAnnouncement("1.6.6")).toBe(true);
});
