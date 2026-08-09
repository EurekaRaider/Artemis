import type { AppLocale } from "@artemis/protocol";
import i18next from "i18next";

import { I18N_RESOURCES } from "../shared/i18n-resources.js";

const mainI18n = i18next.createInstance();
void mainI18n.init({
  resources: I18N_RESOURCES,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "main",
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export type MainTranslationKey = keyof (typeof I18N_RESOURCES)["en"]["main"];

export function mainText(
  locale: AppLocale,
  key: MainTranslationKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  const translate = mainI18n.getFixedT(locale, "main");
  return values ? translate(key, values) : translate(key);
}
