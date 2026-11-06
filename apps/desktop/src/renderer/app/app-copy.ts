import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { type AppLocale } from "@artemis/protocol";
import { type Locale } from "./app-types.js";
export const copy = UI_COPY.App_copy satisfies Record<
  AppLocale,
  Record<string, string>
>;

export function appCopy(locale: Locale): (typeof copy)["en"] {
  return copy[locale];
}
