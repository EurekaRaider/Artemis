// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const { jsdom } = globalThis as typeof globalThis & {
  jsdom: { window: Window };
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

it.each(["localStorage", "sessionStorage"] as const)(
  "uses jsdom's %s for browser reads, writes and quota failures",
  (key) => {
    const storage = globalThis[key];
    expect(storage).toBe(jsdom.window[key]);
    expect(storage).toBeInstanceOf(Storage);
    storage.setItem("draft", "retained");
    expect(jsdom.window[key].getItem("draft")).toBe("retained");

    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    expect(() => storage.setItem("draft", "replacement")).toThrow(
      "Storage full",
    );
    expect(storage.getItem("draft")).toBe("retained");
    storage.removeItem("draft");
    expect(storage.getItem("draft")).toBeNull();
  },
);
