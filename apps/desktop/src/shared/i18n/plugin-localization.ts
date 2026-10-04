import { APP_LOCALES, type AppLocale } from "@artemis/protocol";

export interface PluginLocalizedText {
  displayName?: string;
  description?: string;
  shortDescription?: string;
  longDescription?: string;
  defaultPrompt?: string[];
}

export type PluginLocalizations = Partial<
  Record<AppLocale, PluginLocalizedText>
>;

const textLimits = {
  displayName: 120,
  description: 2_000,
  shortDescription: 300,
  longDescription: 10_000,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePluginLocalizations(
  value: unknown,
): PluginLocalizations | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new Error("Plugin localizations must be an object.");
  const result: PluginLocalizations = {};
  for (const [locale, entry] of Object.entries(value)) {
    if (!APP_LOCALES.includes(locale as AppLocale) || !isRecord(entry)) {
      throw new Error("Plugin localization language or text is invalid.");
    }
    const copy: PluginLocalizedText = {};
    for (const [key, text] of Object.entries(entry)) {
      if (key === "defaultPrompt") {
        if (
          !Array.isArray(text) ||
          text.length > 20 ||
          text.some(
            (prompt) =>
              typeof prompt !== "string" ||
              !prompt.trim() ||
              prompt.length > 2_000,
          )
        )
          throw new Error("Plugin localized prompts are invalid.");
        copy.defaultPrompt = text.map((prompt: string) => prompt.trim());
      } else {
        if (
          !Object.hasOwn(textLimits, key) ||
          typeof text !== "string" ||
          !text.trim() ||
          text.length > textLimits[key as keyof typeof textLimits]
        )
          throw new Error("Plugin localized metadata is invalid or too large.");
        copy[key as keyof typeof textLimits] = text.trim();
      }
    }
    result[locale as AppLocale] = copy;
  }
  return result;
}

export function localizedPluginText(
  plugin: PluginLocalizedText & {
    displayName: string;
    localizations?: PluginLocalizations;
  },
  locale: AppLocale,
): PluginLocalizedText & { displayName: string } {
  return {
    displayName: plugin.displayName,
    ...(plugin.description !== undefined
      ? { description: plugin.description }
      : {}),
    ...(plugin.shortDescription !== undefined
      ? { shortDescription: plugin.shortDescription }
      : {}),
    ...(plugin.longDescription !== undefined
      ? { longDescription: plugin.longDescription }
      : {}),
    ...(plugin.defaultPrompt !== undefined
      ? { defaultPrompt: plugin.defaultPrompt }
      : {}),
    ...plugin.localizations?.en,
    ...plugin.localizations?.[locale],
  };
}

const categoryKeys = ["Communication", "Productivity", "Development", "Design"];
const categoryNames: Record<
  AppLocale,
  readonly [string, string, string, string]
> = {
  en: ["Communication", "Productivity", "Development", "Design"],
  "zh-CN": ["沟通", "效率", "开发", "设计"],
  "zh-TW": ["通訊", "生產力", "開發", "設計"],
  ja: ["コミュニケーション", "仕事効率化", "開発", "デザイン"],
  ko: ["커뮤니케이션", "생산성", "개발", "디자인"],
  es: ["Comunicación", "Productividad", "Desarrollo", "Diseño"],
  fr: ["Communication", "Productivité", "Développement", "Design"],
  de: ["Kommunikation", "Produktivität", "Entwicklung", "Design"],
  "pt-BR": ["Comunicação", "Produtividade", "Desenvolvimento", "Design"],
  it: ["Comunicazione", "Produttività", "Sviluppo", "Design"],
  ru: ["Общение", "Продуктивность", "Разработка", "Дизайн"],
  ar: ["التواصل", "الإنتاجية", "التطوير", "التصميم"],
  hi: ["संचार", "उत्पादकता", "डेवलपमेंट", "डिज़ाइन"],
  id: ["Komunikasi", "Produktivitas", "Pengembangan", "Desain"],
};

export function localizedPluginCategory(
  category: string,
  locale: AppLocale,
): string {
  return categoryNames[locale][categoryKeys.indexOf(category)] ?? category;
}
