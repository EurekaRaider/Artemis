import { z } from "zod";

export const APP_LOCALES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt-BR",
  "it",
  "ru",
  "ar",
  "hi",
  "id",
] as const;

export const appLocaleSchema = z.enum(APP_LOCALES);

export type AppLocale = z.infer<typeof appLocaleSchema>;

export const appLanguageSchema = z.union([
  z.literal("system"),
  appLocaleSchema,
]);

export type AppLanguage = z.infer<typeof appLanguageSchema>;

export const appThemeSchema = z.enum(["system", "light", "dark"]);

export type AppTheme = z.infer<typeof appThemeSchema>;

export const windowsShellPreferenceSchema = z.enum([
  "auto",
  "powershell7",
  "windows-powershell",
]);

export type WindowsShellPreference = z.infer<
  typeof windowsShellPreferenceSchema
>;

export const shellProfileModeSchema = z.enum([
  "environment",
  "full",
  "disabled",
]);

export type ShellProfileMode = z.infer<typeof shellProfileModeSchema>;

export const shellRuntimeConfigurationSchema = z.object({
  windowsPreference: windowsShellPreferenceSchema,
  profileMode: shellProfileModeSchema,
});

export type ShellRuntimeConfiguration = z.infer<
  typeof shellRuntimeConfigurationSchema
>;

export const DEFAULT_SHELL_RUNTIME_CONFIGURATION: ShellRuntimeConfiguration = {
  windowsPreference: "auto",
  profileMode: "environment",
};
