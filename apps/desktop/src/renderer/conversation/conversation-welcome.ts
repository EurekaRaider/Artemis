import type { AppLocale } from "@artemis/protocol";

import { uiText } from "../../shared/i18n/ui-text.js";

export function conversationWelcome(
  locale: AppLocale,
  timestamp: number,
  name: string,
) {
  const hour = new Date(timestamp).getHours();
  const period =
    hour < 5 || hour >= 23
      ? "lateNight"
      : hour < 12
        ? "morning"
        : hour < 18
          ? "afternoon"
          : "evening";
  const promptPeriod =
    period === "morning" ? "morning" : period === "afternoon" ? "day" : "night";
  return {
    title: uiText(locale, `ConversationWelcome.${period}`, { name }),
    projectPrompt: uiText(locale, `ConversationWelcome.${promptPeriod}Project`),
    temporaryPrompt: uiText(
      locale,
      `ConversationWelcome.${promptPeriod}Temporary`,
    ),
  };
}
