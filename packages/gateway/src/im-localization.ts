import type { AppLocale } from "@artemis/protocol";
import en from "./im-locales/en.json" with { type: "json" };
import zhCN from "./im-locales/zh-CN.json" with { type: "json" };
import zhTW from "./im-locales/zh-TW.json" with { type: "json" };
import ja from "./im-locales/ja.json" with { type: "json" };
import ko from "./im-locales/ko.json" with { type: "json" };
import es from "./im-locales/es.json" with { type: "json" };
import fr from "./im-locales/fr.json" with { type: "json" };
import de from "./im-locales/de.json" with { type: "json" };
import ptBR from "./im-locales/pt-BR.json" with { type: "json" };
import it from "./im-locales/it.json" with { type: "json" };
import ru from "./im-locales/ru.json" with { type: "json" };
import ar from "./im-locales/ar.json" with { type: "json" };
import hi from "./im-locales/hi.json" with { type: "json" };
import id from "./im-locales/id.json" with { type: "json" };

export type ImMessageKey = keyof typeof en;
export const IM_MESSAGES: Record<AppLocale, Record<ImMessageKey, string>> = {
  en: en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja: ja,
  ko: ko,
  es: es,
  fr: fr,
  de: de,
  "pt-BR": ptBR,
  it: it,
  ru: ru,
  ar: ar,
  hi: hi,
  id: id,
};

/** Format only authored system copy. User and model text must never be lookup keys. */
export function imText(
  locale: AppLocale | undefined,
  key: ImMessageKey,
  values: Record<string, string | number> = {},
): string {
  return IM_MESSAGES[locale ?? "zh-CN"][key].replace(
    /\{\{(\w+)\}\}/gu,
    (match, name: string) => {
      const value = values[name];
      if (value === undefined) return match;
      // Keep identifiers readable when mixed with right-to-left system copy.
      return locale === "ar" ? `\u2068${value}\u2069` : String(value);
    },
  );
}
