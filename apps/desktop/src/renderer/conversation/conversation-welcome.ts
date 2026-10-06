import type { AppLocale } from "@artemis/protocol";

import { uiText } from "../../shared/i18n/ui-text.js";

export const CONVERSATION_GREETINGS = [
  "morning",
  "afternoon",
  "evening",
  "lateNight",
  "hello",
  "goodToSeeYou",
  "newIdeas",
  "whereToStart",
  "readyWhenYouAre",
  "freshStart",
  "nextStep",
  "eveningIdeas",
  "quietHours",
  "welcomeBack",
  "newWeek",
  "friday",
  "weekend",
] as const;
export type ConversationGreeting = (typeof CONVERSATION_GREETINGS)[number];

function greetingPeriod(timestamp: number) {
  const hour = new Date(timestamp).getHours();
  return hour < 5 || hour >= 23
    ? "lateNight"
    : hour < 12
      ? "morning"
      : hour < 18
        ? "afternoon"
        : "evening";
}

export function chooseConversationGreeting(
  timestamp: number,
  returning: boolean,
  recent: readonly ConversationGreeting[],
  random = Math.random,
): ConversationGreeting {
  const period = greetingPeriod(timestamp);
  const day = new Date(timestamp).getDay();
  const candidates: ConversationGreeting[] = [
    period,
    "hello",
    "goodToSeeYou",
    "newIdeas",
    "whereToStart",
    "readyWhenYouAre",
    (
      {
        morning: "freshStart",
        afternoon: "nextStep",
        evening: "eveningIdeas",
        lateNight: "quietHours",
      } as const
    )[period],
  ];
  if (returning) candidates.push("welcomeBack");
  if (day === 1) candidates.push("newWeek");
  if (day === 5) candidates.push("friday");
  if (day === 0 || day === 6) candidates.push("weekend");
  const eligible = candidates.filter(
    (greeting) => !recent.slice(0, 3).includes(greeting),
  );
  return eligible[Math.floor(random() * eligible.length)]!;
}

export function conversationWelcome(
  locale: AppLocale,
  timestamp: number,
  name: string,
  greeting: ConversationGreeting = greetingPeriod(timestamp),
) {
  const period = greetingPeriod(timestamp);
  const promptPeriod =
    period === "morning" ? "morning" : period === "afternoon" ? "day" : "night";
  return {
    title: uiText(
      locale,
      `ConversationWelcome.${name.trim() ? greeting : "whereToStart"}`,
      { name: name.trim() },
    ),
    projectPrompt: uiText(locale, `ConversationWelcome.${promptPeriod}Project`),
    temporaryPrompt: uiText(
      locale,
      `ConversationWelcome.${promptPeriod}Temporary`,
    ),
  };
}
