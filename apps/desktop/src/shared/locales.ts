import {
  APP_LOCALES,
  type AppLanguage,
  type AppLocale,
} from "@artemis/protocol";

export interface LocaleMetadata {
  id: AppLocale;
  nativeName: string;
  direction: "ltr" | "rtl";
  releaseStatus: "released" | "draft";
  systemAliases: readonly string[];
  acceptLanguage: string;
}

export const LOCALE_METADATA: Readonly<Record<AppLocale, LocaleMetadata>> = {
  en: {
    id: "en",
    nativeName: "English",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["en-US", "en-GB", "en-AU", "en-CA"],
    acceptLanguage: "en-US,en;q=0.9",
  },
  "zh-CN": {
    id: "zh-CN",
    nativeName: "简体中文",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["zh-Hans", "zh-SG", "zh-MY"],
    acceptLanguage: "zh-CN,zh-Hans;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6",
  },
  "zh-TW": {
    id: "zh-TW",
    nativeName: "繁體中文",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["zh-Hant", "zh-HK", "zh-MO"],
    acceptLanguage: "zh-TW,zh-Hant;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6",
  },
  ja: {
    id: "ja",
    nativeName: "日本語",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["ja-JP"],
    acceptLanguage: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  ko: {
    id: "ko",
    nativeName: "한국어",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["ko-KR"],
    acceptLanguage: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  es: {
    id: "es",
    nativeName: "Español",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["es-ES", "es-419", "es-MX"],
    acceptLanguage: "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  fr: {
    id: "fr",
    nativeName: "Français",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["fr-FR", "fr-CA"],
    acceptLanguage: "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  de: {
    id: "de",
    nativeName: "Deutsch",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["de-DE", "de-AT", "de-CH"],
    acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  "pt-BR": {
    id: "pt-BR",
    nativeName: "Português (Brasil)",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["pt", "pt-PT"],
    acceptLanguage: "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  it: {
    id: "it",
    nativeName: "Italiano",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["it-IT"],
    acceptLanguage: "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  ru: {
    id: "ru",
    nativeName: "Русский",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["ru-RU"],
    acceptLanguage: "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  ar: {
    id: "ar",
    nativeName: "العربية",
    direction: "rtl",
    releaseStatus: "released",
    systemAliases: ["ar-SA", "ar-EG", "ar-AE"],
    acceptLanguage: "ar,ar-SA;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  hi: {
    id: "hi",
    nativeName: "हिन्दी",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["hi-IN"],
    acceptLanguage: "hi-IN,hi;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  id: {
    id: "id",
    nativeName: "Bahasa Indonesia",
    direction: "ltr",
    releaseStatus: "released",
    systemAliases: ["id-ID", "in-ID"],
    acceptLanguage: "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  },
};

export const SUPPORTED_LOCALES: readonly AppLocale[] = APP_LOCALES.filter(
  (locale) => LOCALE_METADATA[locale].releaseStatus === "released",
);
export type LegacyLocale = "en" | "zh-CN";

const LOCALE_IDS = new Set<string>(APP_LOCALES);
const SYSTEM_ALIAS_LOCALES = new Map<string, AppLocale>(
  APP_LOCALES.flatMap((locale) =>
    LOCALE_METADATA[locale].systemAliases.map((alias) => [
      alias.toLowerCase(),
      locale,
    ]),
  ),
);

function normalizedLocale(value: string): string {
  return value.trim().replaceAll("_", "-");
}

function chineseLocale(value: string): AppLocale | undefined {
  const normalized = value.toLowerCase();
  if (!normalized.startsWith("zh")) return undefined;
  if (
    normalized.includes("hant") ||
    /(?:^|-)(?:tw|hk|mo)(?:-|$)/u.test(normalized)
  ) {
    return "zh-TW";
  }
  return "zh-CN";
}

export function matchKnownLocale(value: string): AppLocale | undefined {
  const normalized = normalizedLocale(value);
  const exact = APP_LOCALES.find(
    (locale) => locale.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact) return exact;

  const alias = SYSTEM_ALIAS_LOCALES.get(normalized.toLowerCase());
  if (alias) return alias;

  const chinese = chineseLocale(normalized);
  if (chinese) return chinese;

  const canonical = Intl.getCanonicalLocales(normalized)[0] ?? normalized;
  if (LOCALE_IDS.has(canonical)) return canonical as AppLocale;

  const language = canonical.split("-", 1)[0]?.toLowerCase();
  if (!language) return undefined;
  if (language === "pt") return "pt-BR";
  return LOCALE_IDS.has(language) ? (language as AppLocale) : undefined;
}

export function matchSupportedLocale(value: string): AppLocale | undefined {
  const locale = matchKnownLocale(value);
  return locale && SUPPORTED_LOCALES.includes(locale) ? locale : undefined;
}

export function resolveAppLocale(
  preference: AppLanguage,
  preferredSystemLanguages: readonly string[],
): AppLocale {
  if (preference !== "system") return preference;
  for (const language of preferredSystemLanguages) {
    try {
      const match = matchSupportedLocale(language);
      if (match) return match;
    } catch {
      // Ignore malformed OS locale entries and continue through its preference list.
    }
  }
  return "en";
}

export function localeDirection(locale: AppLocale): "ltr" | "rtl" {
  return LOCALE_METADATA[locale].direction;
}

export function legacyLocale(locale: AppLocale): LegacyLocale {
  return locale === "zh-CN" ? "zh-CN" : "en";
}
