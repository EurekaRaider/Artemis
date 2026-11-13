import { APP_LOCALES } from "@artemis/protocol";
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_GREETINGS,
  RECENT_GREETING_LIMIT,
  chooseConversationGreeting,
  conversationWelcome,
  type ConversationGreeting,
} from "../../../src/renderer/conversation/conversation-welcome.js";
import { UI_RESOURCES } from "../../../src/shared/i18n/ui-text.js";

/** Saturday 3 October 2026, local time. */
const localTime = (hour: number, minute = 0) =>
  new Date(2026, 9, 3, hour, minute).getTime();

/** Every greeting that can be drawn; each one's share exceeds 1/samples. */
const possibleGreetings = (
  timestamp: number,
  returning = false,
  recent: readonly ConversationGreeting[] = [],
  samples = 200,
) =>
  new Set(
    Array.from({ length: samples }, (_, index) =>
      chooseConversationGreeting(
        timestamp,
        returning,
        recent,
        () => index / samples,
      ),
    ),
  );

const PERIOD_GREETINGS = {
  morning: [
    "morning",
    "freshStart",
    "morningShort",
    "goodMorningAlt",
    "dayJustBegun",
  ],
  afternoon: [
    "afternoon",
    "afternoonShort",
    "afternoonOnward",
    "steadyProgress",
    "afternoonSession",
  ],
  evening: ["evening", "eveningShort", "longDay", "wrapUp", "quietEvening"],
  lateNight: [
    "lateNight",
    "quietHours",
    "stillUp",
    "nightOwl",
    "burningMidnightOil",
    "moonWatch",
  ],
} as const satisfies Record<string, ConversationGreeting[]>;

const ALWAYS_AVAILABLE: ConversationGreeting[] = [
  "hello",
  "goodToSeeYou",
  "readyWhenYouAre",
  "hi",
  "youreHere",
  "imHere",
  "allSet",
  "letsBegin",
  "takeYourTime",
  "startSmall",
  "sayTheWord",
  "yourCall",
  "carryOn",
  "goodTiming",
  "blankPage",
  "buildTogether",
  "aimTrue",
  "bowReady",
  "aimAndGo",
  "arrowByArrow",
];

describe("conversation welcome", () => {
  it("offers sixty greetings, twenty of them at any moment", () => {
    expect(CONVERSATION_GREETINGS).toHaveLength(60);
    for (const greeting of [
      "newIdeas",
      "whereToStart",
      "nextStep",
      "eveningIdeas",
    ])
      expect(CONVERSATION_GREETINGS).not.toContain(greeting);
    for (let hour = 0; hour < 24; hour++)
      for (const greeting of ALWAYS_AVAILABLE)
        expect(possibleGreetings(localTime(hour))).toContain(greeting);
  });

  it.each([
    [2, "lateNight"],
    [6, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [22, "evening"],
    [23, "lateNight"],
  ] as const)("offers only %i:00 greetings of the %s", (hour, period) => {
    const possible = possibleGreetings(localTime(hour));
    for (const [other, greetings] of Object.entries(PERIOD_GREETINGS))
      for (const greeting of greetings)
        expect(possible.has(greeting)).toBe(other === period);
    expect(possible.has("moonlight")).toBe(
      period === "evening" || period === "lateNight",
    );
  });

  it.each([
    ["earlyRiser", 5, 8],
    ["noon", 11, 14],
    ["middayAlready", 11, 14],
    ["teaTime", 15, 17],
  ] as const)("offers %s from %i:00 until %i:00", (greeting, from, to) => {
    for (let hour = 0; hour < 24; hour++)
      expect(possibleGreetings(localTime(hour)).has(greeting)).toBe(
        hour >= from && hour < to,
      );
  });

  it.each([0, 1, 2, 3, 4, 5, 6])(
    "limits weekday greetings to the local day %i",
    (day) => {
      const possible = possibleGreetings(
        new Date(2026, 9, 4 + day, 10).getTime(),
      );
      expect(possible.has("newWeek")).toBe(day === 1);
      expect(possible.has("monday")).toBe(day === 1);
      expect(possible.has("midweek")).toBe(day === 3);
      expect(possible.has("almostFriday")).toBe(day === 4);
      expect(possible.has("friday")).toBe(day === 5);
      expect(possible.has("fridayAtLast")).toBe(day === 5);
      expect(possible.has("saturday")).toBe(day === 6);
      expect(possible.has("sunday")).toBe(day === 0);
      expect(possible.has("weekend")).toBe(day === 0 || day === 6);
      expect(possible.has("weekendYours")).toBe(day === 0 || day === 6);
    },
  );

  it.each([
    [new Date(2027, 0, 1, 10), true, true],
    [new Date(2026, 10, 1, 10), false, true],
    [new Date(2026, 10, 2, 10), false, false],
    [new Date(2026, 11, 31, 23, 59), false, false],
  ])("marks the new year and month on %s", (date, newYear, newMonth) => {
    const possible = possibleGreetings(date.getTime());
    expect(possible.has("newYear")).toBe(newYear);
    expect(possible.has("newMonth")).toBe(newMonth);
  });

  it("only welcomes back a returning visitor", () => {
    for (const greeting of ["welcomeBack", "seeYouAgain"] as const) {
      expect(possibleGreetings(localTime(10))).not.toContain(greeting);
      expect(possibleGreetings(localTime(10), true)).toContain(greeting);
    }
  });

  it("can show every greeting at some moment", () => {
    const seen = new Set<ConversationGreeting>();
    for (let day = 0; day < 7; day++)
      for (let hour = 0; hour < 24; hour++)
        for (const greeting of possibleGreetings(
          new Date(2026, 9, 4 + day, hour).getTime(),
          true,
        ))
          seen.add(greeting);
    for (const greeting of possibleGreetings(
      new Date(2027, 0, 1, 10).getTime(),
    ))
      seen.add(greeting);
    expect([...seen].sort()).toEqual([...CONVERSATION_GREETINGS].sort());
  });

  it("weights greetings that fit the moment twice as much as general ones", () => {
    const counts = new Map<ConversationGreeting, number>();
    for (let index = 0; index < 10_000; index++) {
      const greeting = chooseConversationGreeting(
        localTime(10),
        false,
        [],
        () => index / 10_000,
      );
      counts.set(greeting, (counts.get(greeting) ?? 0) + 1);
    }
    const ratio = counts.get("morning")! / counts.get("hello")!;
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  it("avoids the ten most recently displayed greetings", () => {
    expect(RECENT_GREETING_LIMIT).toBe(10);
    const recent: ConversationGreeting[] = [
      "morning",
      "hello",
      "goodToSeeYou",
      "readyWhenYouAre",
      "freshStart",
      "hi",
      "youreHere",
      "imHere",
      "allSet",
      "letsBegin",
      "takeYourTime",
    ];
    const possible = possibleGreetings(localTime(10), true, recent);
    for (const greeting of recent.slice(0, RECENT_GREETING_LIMIT))
      expect(possible).not.toContain(greeting);
    expect(possible).toContain("takeYourTime");
  });

  it("never runs out of greetings at any hour", () => {
    for (let hour = 0; hour < 24; hour++) {
      const recent = ALWAYS_AVAILABLE.slice(0, RECENT_GREETING_LIMIT);
      for (const greeting of possibleGreetings(localTime(hour), false, recent))
        expect(recent).not.toContain(greeting);
    }
  });

  it("uses a natural unnamed greeting when the display name is empty", () => {
    expect(
      conversationWelcome("zh-CN", localTime(10), "  ", "welcomeBack").title,
    ).toBe("随时可以开始");
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
    [8, "今早想在 {{workspace}} 里一起做些什么？", "今早想一起做些什么？"],
    [15, "今天想在 {{workspace}} 里一起做些什么？", "今天想一起做些什么？"],
    [20, "今晚想在 {{workspace}} 里一起做些什么？", "今晚想一起做些什么？"],
    [2, "今晚想在 {{workspace}} 里一起做些什么？", "今晚想一起做些什么？"],
  ] as const)(
    "keeps project context separate from the temporary welcome at %i:00",
    (hour, projectPrompt, temporaryPrompt) => {
      const copy = conversationWelcome("zh-CN", localTime(hour), "William");
      expect(copy.projectPrompt).toBe(projectPrompt);
      expect(copy.temporaryPrompt).toBe(temporaryPrompt);
      expect(copy.temporaryPrompt).not.toContain("{{workspace}}");
    },
  );

  it.each([
    ["zh-CN", "项目"],
    ["zh-TW", "專案"],
    ["ko", "프로젝트"],
    ["hi", "प्रोजेक्ट"],
    ["ar", "مشروع"],
  ] as const)(
    "names the workspace without a generic project noun in %s",
    (locale, noun) => {
      for (const hour of [8, 15, 20]) {
        const copy = conversationWelcome(locale, localTime(hour), "William");
        expect(copy.projectPrompt).toContain("{{workspace}}");
        expect(copy.projectPrompt).not.toContain(noun);
      }
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
