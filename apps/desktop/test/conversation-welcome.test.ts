import { APP_LOCALES } from "@artemis/protocol";
import { describe, expect, it } from "vitest";

import { conversationWelcome } from "../src/renderer/conversation-welcome.js";

const localTime = (hour: number, minute = 0) =>
  new Date(2026, 9, 3, hour, minute).getTime();

describe("conversation welcome", () => {
  it.each([
    [0, 0, "夜深了，William"],
    [4, 59, "夜深了，William"],
    [5, 0, "早上好，William"],
    [11, 59, "早上好，William"],
    [12, 0, "下午好，William"],
    [17, 59, "下午好，William"],
    [18, 0, "晚上好，William"],
    [22, 59, "晚上好，William"],
    [23, 0, "夜深了，William"],
    [23, 59, "夜深了，William"],
  ] as const)(
    "uses the local-time greeting at %i:%i",
    (hour, minute, expected) => {
      expect(
        conversationWelcome("zh-CN", localTime(hour, minute), "William").title,
      ).toBe(expected);
    },
  );

  it.each([
    [
      8,
      "新的一天，想在 {{workspace}} 项目里一起做些什么？",
      "很高兴见到你，新的一天想一起做些什么？",
    ],
    [
      15,
      "今天想在 {{workspace}} 项目里一起做些什么？",
      "很高兴见到你，今天想一起做些什么？",
    ],
    [
      20,
      "今晚想在 {{workspace}} 项目里一起做些什么？",
      "很高兴见到你，今晚想一起做些什么？",
    ],
    [
      2,
      "今晚想在 {{workspace}} 项目里一起做些什么？",
      "很高兴见到你，今晚想一起做些什么？",
    ],
  ] as const)(
    "keeps project context separate from the temporary welcome at %i:00",
    (hour, projectPrompt, temporaryPrompt) => {
      const copy = conversationWelcome("zh-CN", localTime(hour), "William");
      expect(copy.projectPrompt).toBe(projectPrompt);
      expect(copy.temporaryPrompt).toBe(temporaryPrompt);
      expect(copy.temporaryPrompt).not.toContain("{{workspace}}");
    },
  );

  it.each(APP_LOCALES)("localizes each time period in %s", (locale) => {
    for (const hour of [8, 15, 20, 2]) {
      const copy = conversationWelcome(locale, localTime(hour), "William");
      expect(copy.title).toContain("William");
      expect(copy.title).not.toContain("{{name}}");
      expect(copy.projectPrompt).toContain("{{workspace}}");
      expect(copy.temporaryPrompt).not.toContain("{{");
      if (locale !== "en") {
        const english = conversationWelcome("en", localTime(hour), "William");
        expect(copy.title).not.toBe(english.title);
        expect(copy.projectPrompt).not.toBe(english.projectPrompt);
        expect(copy.temporaryPrompt).not.toBe(english.temporaryPrompt);
      }
    }
  });
});
