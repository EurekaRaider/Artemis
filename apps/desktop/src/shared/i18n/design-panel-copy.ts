import type { AppLocale } from "@artemis/protocol";
import { localeDirection } from "./locales.js";
import { UI_RESOURCES } from "./ui-text.js";

export function designPanelLocaleMessage(locale: AppLocale) {
  return {
    type: "locale" as const,
    locale,
    direction: localeDirection(locale),
    messages: Object.fromEntries(
      Object.entries(UI_RESOURCES[locale])
        .filter(([key]) => key.startsWith("DesignPanel."))
        .map(([key, value]) => [key.slice("DesignPanel.".length), value]),
    ),
  };
}
