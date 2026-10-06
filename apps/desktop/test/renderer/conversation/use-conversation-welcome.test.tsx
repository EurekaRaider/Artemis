// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLocale } from "@artemis/protocol";
import "../../fixtures/renderer-test-utils.js";
import { useConversationWelcome } from "../../../src/renderer/conversation/use-conversation-welcome.js";

const key = "artemis-conversation-welcome-v1";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 6, 10));
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("conversation greeting lifecycle", () => {
  it("keeps the selection and time context stable through rerenders and locale changes", () => {
    const { result, rerender } = renderHook(
      ({ locale, name }) => useConversationWelcome(locale, name),
      { initialProps: { locale: "zh-CN" as AppLocale, name: "William" } },
    );
    const history = localStorage.getItem(key);
    vi.setSystemTime(new Date(2026, 9, 6, 23));
    rerender({ locale: "zh-CN", name: "William" });
    expect(result.current.welcome.title).toBe("早上好，William");
    expect(result.current.welcome.projectPrompt).toContain("今早");
    expect(localStorage.getItem(key)).toBe(history);
    rerender({ locale: "fr", name: "Alex" });
    expect(result.current.welcome.title).toBe("Bonjour, Alex");
    expect(localStorage.getItem(key)).toBe(history);
    act(() => result.current.renew());
    expect(result.current.welcome.title).toBe("La nuit est bien avancée, Alex");
  });

  it("renews on explicit new conversations and saves only three recent IDs", () => {
    const { result } = renderHook(() =>
      useConversationWelcome("zh-CN", "William"),
    );
    const recent: string[] = [];
    for (let index = 0; index < 10; index++) {
      const title = result.current.welcome.title;
      expect(recent.slice(-3)).not.toContain(title);
      recent.push(title);
      act(() => result.current.renew());
    }
    const stored = JSON.parse(localStorage.getItem(key)!);
    expect(stored.protocolVersion).toBe(1);
    expect(stored.recent).toHaveLength(3);
    expect(localStorage.getItem(key)).not.toContain("William");
    expect(Object.keys(stored)).toEqual(["protocolVersion", "recent"]);
  });

  it("recognizes a real previous visit and excludes the last greeting after remount", () => {
    vi.mocked(Math.random).mockReturnValue(0.999);
    const first = renderHook(() => useConversationWelcome("zh-CN", "William"));
    expect(first.result.current.welcome.title).not.toBe("欢迎回来，William");
    first.unmount();
    const second = renderHook(() => useConversationWelcome("zh-CN", "William"));
    expect(second.result.current.welcome.title).toBe("欢迎回来，William");
    second.unmount();
    const third = renderHook(() => useConversationWelcome("zh-CN", "William"));
    expect(third.result.current.welcome.title).not.toBe("欢迎回来，William");
  });

  it("does not consume history on Strict Mode effect replay", () => {
    const { rerender } = renderHook(
      () => useConversationWelcome("zh-CN", "William"),
      {
        wrapper: StrictMode,
      },
    );
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      protocolVersion: 1,
      recent: ["morning"],
    });
    rerender();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      protocolVersion: 1,
      recent: ["morning"],
    });
  });

  it.each([
    "broken",
    '{"protocolVersion":2,"recent":["hello"]}',
    '{"protocolVersion":1,"recent":["unknown"]}',
    '{"protocolVersion":1,"recent":[]}',
    '{"protocolVersion":1,"recent":["hello","morning","newIdeas","friday"]}',
  ])("treats invalid history as a first visit: %s", (raw) => {
    localStorage.setItem(key, raw);
    vi.mocked(Math.random).mockReturnValue(0.999);
    const { result } = renderHook(() =>
      useConversationWelcome("zh-CN", "William"),
    );
    expect(result.current.welcome.title).not.toBe("欢迎回来，William");
  });

  it("stays usable when local storage is unavailable", () => {
    for (const method of ["getItem", "setItem"] as const)
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("unavailable");
      });
    const { result } = renderHook(() =>
      useConversationWelcome("zh-CN", "William"),
    );
    expect(result.current.welcome.title).toBe("早上好，William");
    act(() => result.current.renew());
    expect(result.current.welcome.title).toBe("你好，William");
  });
});
