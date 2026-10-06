import { APP_LOCALES } from "@artemis/protocol";
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_GREETINGS,
  chooseConversationGreeting,
  conversationWelcome,
  type ConversationGreeting,
} from "../../../src/renderer/conversation/conversation-welcome.js";
import { UI_RESOURCES } from "../../../src/shared/i18n/ui-text.js";

const localTime = (hour: number, minute = 0) =>
  new Date(2026, 9, 3, hour, minute).getTime();

describe("conversation welcome", () => {
  const possibleGreetings = (timestamp: number, returning = false) =>
    new Set(
      Array.from({ length: 100 }, (_, index) =>
        chooseConversationGreeting(timestamp, returning, [], () => index / 100),
      ),
    );

  it.each([
    [8, "morning", "freshStart"],
    [15, "afternoon", "nextStep"],
    [20, "evening", "eveningIdeas"],
    [2, "lateNight", "quietHours"],
  ] as const)(
    "offers general and matching time greetings at %i:00",
    (hour, period, variant) => {
      const possible = possibleGreetings(localTime(hour));
      expect(possible).toContain(period);
      expect(possible).toContain(variant);
      expect(possible).toContain("newIdeas");
      expect(possible).toContain("goodToSeeYou");
      for (const other of ["morning", "afternoon", "evening", "lateNight"])
        if (other !== period) expect(possible).not.toContain(other);
    },
  );

  it.each([0, 1, 2, 3, 4, 5, 6])(
    "limits weekday greetings to the local day %i",
    (day) => {
      const possible = possibleGreetings(
        new Date(2026, 9, 4 + day, 10).getTime(),
      );
      expect(possible.has("newWeek")).toBe(day === 1);
      expect(possible.has("friday")).toBe(day === 5);
      expect(possible.has("weekend")).toBe(day === 0 || day === 6);
    },
  );

  it("only offers welcome back to a returning visitor", () => {
    expect(possibleGreetings(localTime(10))).not.toContain("welcomeBack");
    expect(possibleGreetings(localTime(10), true)).toContain("welcomeBack");
  });

  it("avoids all three recently displayed greetings", () => {
    const recent: ConversationGreeting[] = ["morning", "hello", "goodToSeeYou"];
    for (let index = 0; index < 100; index++)
      expect(recent).not.toContain(
        chooseConversationGreeting(
          localTime(10),
          true,
          recent,
          () => index / 100,
        ),
      );
  });

  it("uses a natural unnamed greeting when the display name is empty", () => {
    expect(
      conversationWelcome("zh-CN", localTime(10), "  ", "welcomeBack").title,
    ).toBe("今天从哪里开始？");
  });

  it.each(APP_LOCALES)(
    "renders distinct greetings without placeholders or English fallback in %s",
    (locale) => {
      const titles = new Set<string>();
      for (const greeting of CONVERSATION_GREETINGS) {
        const key = `ConversationWelcome.${greeting}` as const;
        const copy = conversationWelcome(
          locale,
          localTime(10),
          "William",
          greeting,
        );
        titles.add(copy.title);
        expect(copy.title.trim()).not.toBe("");
        expect(copy.title).not.toContain("{{");
        if (UI_RESOURCES[locale][key].includes("{{name}}"))
          expect(copy.title).toContain("William");
        if (locale !== "en")
          expect(copy.title).not.toBe(
            conversationWelcome("en", localTime(10), "William", greeting).title,
          );
      }
      expect(titles.size).toBe(CONVERSATION_GREETINGS.length);
    },
  );

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
    [8, "今早想在 {{workspace}} 项目里一起做些什么？", "今早想一起做些什么？"],
    [15, "今天想在 {{workspace}} 项目里一起做些什么？", "今天想一起做些什么？"],
    [20, "今晚想在 {{workspace}} 项目里一起做些什么？", "今晚想一起做些什么？"],
    [2, "今晚想在 {{workspace}} 项目里一起做些什么？", "今晚想一起做些什么？"],
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
