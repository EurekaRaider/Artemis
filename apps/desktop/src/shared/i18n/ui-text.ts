import { APP_LOCALES, type AppLocale } from "@artemis/protocol";
import en from "./ui-locales/en.json";
import zhCN from "./ui-locales/zh-CN.json";
import zhTW from "./ui-locales/zh-TW.json";
import ja from "./ui-locales/ja.json";
import ko from "./ui-locales/ko.json";
import es from "./ui-locales/es.json";
import fr from "./ui-locales/fr.json";
import de from "./ui-locales/de.json";
import ptBR from "./ui-locales/pt-BR.json";
import it from "./ui-locales/it.json";
import ru from "./ui-locales/ru.json";
import ar from "./ui-locales/ar.json";
import hi from "./ui-locales/hi.json";
import id from "./ui-locales/id.json";

export type UiMessageKey = keyof typeof en;
export type UiMessageValues = Readonly<Record<string, string | number>>;
export type UiTranslate = (
  key: UiMessageKey,
  values?: UiMessageValues,
) => string;
export const UI_RESOURCES: Readonly<
  Record<AppLocale, Record<UiMessageKey, string>>
> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
  es,
  fr,
  de,
  "pt-BR": ptBR,
  it,
  ru,
  ar,
  hi,
  id,
};

export function uiText(
  locale: AppLocale,
  key: UiMessageKey,
  values?: UiMessageValues,
): string {
  const template = UI_RESOURCES[locale][key];
  return values
    ? template.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
        const value = values[name];
        if (value === undefined) return placeholder;
        const text = String(value);
        return locale === "ar" && typeof value === "string"
          ? `\u2068${text}\u2069`
          : text;
      })
    : template;
}

export function uiTranslator(locale: AppLocale): UiTranslate {
  return (key, values) => uiText(locale, key, values);
}

export function makeUiCopy<T>(
  factory: (locale: AppLocale) => T,
): Record<AppLocale, T> {
  return Object.fromEntries(
    APP_LOCALES.map((locale) => [locale, factory(locale)]),
  ) as Record<AppLocale, T>;
}
