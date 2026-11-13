// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLocale } from "@artemis/protocol";
import "../../fixtures/renderer-test-utils.js";
import { chooseConversationGreeting } from "../../../src/renderer/conversation/conversation-welcome.js";
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

  it("renews on explicit new conversations and saves only ten recent IDs", () => {
    const { result } = renderHook(() =>
      useConversationWelcome("zh-CN", "William"),
    );
    const recent: string[] = [];
    for (let index = 0; index < 15; index++) {
      const title = result.current.welcome.title;
      expect(recent.slice(-10)).not.toContain(title);
      recent.push(title);
      act(() => result.current.renew());
    }
    const stored = JSON.parse(localStorage.getItem(key)!);
    expect(stored.protocolVersion).toBe(1);
    expect(stored.recent).toHaveLength(10);
    expect(localStorage.getItem(key)).not.toContain("William");
    expect(Object.keys(stored)).toEqual(["protocolVersion", "recent"]);
  });

  it("welcomes back only on the first greeting of a later launch", () => {
    vi.mocked(Math.random).mockReturnValue(0.999);
    const returningTitles = ["欢迎回来，William", "又见面了，William"];
    const first = renderHook(() => useConversationWelcome("zh-CN", "William"));
    expect(returningTitles).not.toContain(first.result.current.welcome.title);
    first.unmount();

    const second = renderHook(() => useConversationWelcome("zh-CN", "William"));
    expect(second.result.current.welcome.title).toBe("又见面了，William");
    // A draw that would pick "welcome back" if renewal still counted as returning.
    const recent = JSON.parse(localStorage.getItem(key)!).recent;
    const welcomeBackDraw = Array.from({ length: 200 }, (_, i) => i / 200).find(
      (draw) =>
        chooseConversationGreeting(Date.now(), true, recent, () => draw) ===
        "welcomeBack",
    );
    expect(welcomeBackDraw).toBeDefined();
    vi.mocked(Math.random).mockReturnValue(welcomeBackDraw!);
    act(() => second.result.current.renew());
    expect(returningTitles).not.toContain(second.result.current.welcome.title);
    second.unmount();

    vi.mocked(Math.random).mockReturnValue(0.999);
    const third = renderHook(() => useConversationWelcome("zh-CN", "William"));
    expect(third.result.current.welcome.title).not.toBe("又见面了，William");
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
    '{"protocolVersion":1,"recent":["newIdeas"]}',
    JSON.stringify({
      protocolVersion: 1,
      recent: [
        "hello",
        "morning",
        "hi",
        "imHere",
        "allSet",
        "letsBegin",
        "carryOn",
        "aimTrue",
        "bowReady",
        "aimAndGo",
        "friday",
      ],
    }),
  ])("treats invalid history as a first visit: %s", (raw) => {
    localStorage.setItem(key, raw);
    vi.mocked(Math.random).mockReturnValue(0.999);
    const { result } = renderHook(() =>
      useConversationWelcome("zh-CN", "William"),
    );
    expect(["欢迎回来，William", "又见面了，William"]).not.toContain(
      result.current.welcome.title,
    );
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
