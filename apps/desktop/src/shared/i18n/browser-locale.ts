import type { AppLocale } from "@artemis/protocol";

import { LOCALE_METADATA } from "./locales.js";

export type BrowserLocale = AppLocale;

export const BROWSER_SESSION_PARTITION = "persist:artemis-browser";

export function browserAcceptLanguage(locale: BrowserLocale): string {
  return LOCALE_METADATA[locale].acceptLanguage;
}

export function withBrowserAcceptLanguage(
  requestHeaders: Readonly<Record<string, string>>,
  locale: BrowserLocale,
): Record<string, string> {
  const existingHeader = Object.keys(requestHeaders).find(
    (name) => name.toLowerCase() === "accept-language",
  );
  const nextHeaders = Object.fromEntries(
    Object.entries(requestHeaders).filter(
      ([name]) => name.toLowerCase() !== "accept-language",
    ),
  );
  nextHeaders[existingHeader ?? "Accept-Language"] =
    browserAcceptLanguage(locale);
  return nextHeaders;
}

export function isRemoteBrowserUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function shouldReloadBrowserForLocaleChange(
  previousLocale: BrowserLocale,
  nextLocale: BrowserLocale,
  currentUrl: string,
): boolean {
  return previousLocale !== nextLocale && isRemoteBrowserUrl(currentUrl);
}
