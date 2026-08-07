export type BrowserLocale = "en" | "zh-CN";

export const BROWSER_SESSION_PARTITION = "persist:artemis-browser";

const ACCEPT_LANGUAGE_BY_LOCALE: Record<BrowserLocale, string> = {
  en: "en-US,en;q=0.9",
  "zh-CN": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
};

export function browserAcceptLanguage(locale: BrowserLocale): string {
  return ACCEPT_LANGUAGE_BY_LOCALE[locale];
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
