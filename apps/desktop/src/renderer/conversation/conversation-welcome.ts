import type { AppLocale } from "@artemis/protocol";

import { uiText } from "../../shared/i18n/ui-text.js";

type GreetingPeriod = "morning" | "afternoon" | "evening" | "lateNight";

interface GreetingMoment {
  readonly hour: number;
  /** 0 is Sunday. */
  readonly day: number;
  readonly date: number;
  readonly month: number;
  readonly period: GreetingPeriod;
  /** The first greeting after launch for someone who has been here before. */
  readonly returning: boolean;
}

/** The last greetings shown, which are not repeated. */
export const RECENT_GREETING_LIMIT = 10;

const always = () => true;
const at =
  (period: GreetingPeriod) =>
  ({ period: current }: GreetingMoment) =>
    current === period;
const between =
  (from: number, to: number) =>
  ({ hour }: GreetingMoment) =>
    hour >= from && hour < to;
const onDay =
  (...days: number[]) =>
  ({ day }: GreetingMoment) =>
    days.includes(day);

/** When each greeting may appear. Order matters only for deterministic tests. */
const GREETING_CONDITIONS = {
  morning: at("morning"),
  afternoon: at("afternoon"),
  evening: at("evening"),
  lateNight: at("lateNight"),
  hello: always,
  goodToSeeYou: always,
  readyWhenYouAre: always,
  freshStart: at("morning"),
  quietHours: at("lateNight"),
  welcomeBack: ({ returning }: GreetingMoment) => returning,
  newWeek: onDay(1),
  friday: onDay(5),
  weekend: onDay(0, 6),
  hi: always,
  youreHere: always,
  imHere: always,
  allSet: always,
  letsBegin: always,
  takeYourTime: always,
  startSmall: always,
  sayTheWord: always,
  yourCall: always,
  carryOn: always,
  goodTiming: always,
  blankPage: always,
  buildTogether: always,
  aimTrue: always,
  bowReady: always,
  aimAndGo: always,
  arrowByArrow: always,
  morningShort: at("morning"),
  goodMorningAlt: at("morning"),
  dayJustBegun: at("morning"),
  earlyRiser: between(5, 8),
  noon: between(11, 14),
  middayAlready: between(11, 14),
  afternoonShort: at("afternoon"),
  afternoonOnward: at("afternoon"),
  steadyProgress: at("afternoon"),
  afternoonSession: at("afternoon"),
  teaTime: between(15, 17),
  eveningShort: at("evening"),
  longDay: at("evening"),
  wrapUp: at("evening"),
  quietEvening: at("evening"),
  moonlight: ({ period }: GreetingMoment) =>
    period === "evening" || period === "lateNight",
  stillUp: at("lateNight"),
  nightOwl: at("lateNight"),
  burningMidnightOil: at("lateNight"),
  moonWatch: at("lateNight"),
  monday: onDay(1),
  midweek: onDay(3),
  almostFriday: onDay(4),
  fridayAtLast: onDay(5),
  saturday: onDay(6),
  sunday: onDay(0),
  weekendYours: onDay(0, 6),
  seeYouAgain: ({ returning }: GreetingMoment) => returning,
  newYear: ({ month, date }: GreetingMoment) => month === 0 && date === 1,
  newMonth: ({ date }: GreetingMoment) => date === 1,
} satisfies Record<string, (moment: GreetingMoment) => boolean>;

export type ConversationGreeting = keyof typeof GREETING_CONDITIONS;
export const CONVERSATION_GREETINGS = Object.keys(GREETING_CONDITIONS) as [
  ConversationGreeting,
  ...ConversationGreeting[],
];

function greetingPeriod(timestamp: number): GreetingPeriod {
  const hour = new Date(timestamp).getHours();
  return hour < 5 || hour >= 23
    ? "lateNight"
    : hour < 12
      ? "morning"
      : hour < 18
        ? "afternoon"
        : "evening";
}

/** Greetings that fit the moment outweigh the always-available ones. */
function greetingWeight(greeting: ConversationGreeting) {
  return GREETING_CONDITIONS[greeting] === always ? 1 : 2;
}

export function chooseConversationGreeting(
  timestamp: number,
  returning: boolean,
  recent: readonly ConversationGreeting[],
  random = Math.random,
): ConversationGreeting {
  const time = new Date(timestamp);
  const moment: GreetingMoment = {
    hour: time.getHours(),
    day: time.getDay(),
    date: time.getDate(),
    month: time.getMonth(),
    period: greetingPeriod(timestamp),
    returning,
  };
  const excluded = new Set(recent.slice(0, RECENT_GREETING_LIMIT));
  const eligible = CONVERSATION_GREETINGS.filter(
    (greeting) =>
      GREETING_CONDITIONS[greeting](moment) && !excluded.has(greeting),
  );
  let remaining =
    random() *
    eligible.reduce((total, greeting) => total + greetingWeight(greeting), 0);
  return (
    eligible.find((greeting) => (remaining -= greetingWeight(greeting)) < 0) ??
    eligible.at(-1)!
  );
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
      `ConversationWelcome.${name.trim() ? greeting : "readyWhenYouAre"}`,
      { name: name.trim() },
    ),
    projectPrompt: uiText(locale, `ConversationWelcome.${promptPeriod}Project`),
    temporaryPrompt: uiText(
      locale,
      `ConversationWelcome.${promptPeriod}Temporary`,
    ),
  };
}
