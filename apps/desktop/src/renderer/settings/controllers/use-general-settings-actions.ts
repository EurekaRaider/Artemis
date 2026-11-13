import type {
  AppLanguage,
  AppTheme,
  ShellProfileMode,
  WindowsShellPreference,
} from "@artemis/protocol";

import type { MaterialPreference } from "../../../shared/window-material.js";
import type { SettingsSnapshot } from "../../../shared/api.js";

import { prepareProfileAvatar } from "../../app/profile-avatar.js";

interface UseGeneralSettingsActionsContext {
  readonly setSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly onSettingsChange: (
    settings: SettingsSnapshot,
    options?: {
      refreshThreads?: boolean;
    },
  ) => void;
  readonly run: (action: () => Promise<void>) => Promise<void>;
  readonly locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  readonly settings: SettingsSnapshot | undefined;
  readonly parsedAgentConcurrencyLimit: number;
  readonly agentConcurrencyLimitValid: boolean;
  readonly setAgentConcurrencyLimit: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
}
export function useGeneralSettingsActions(
  context: UseGeneralSettingsActionsContext,
) {
  const {
    setSettings,
    onSettingsChange,
    locale,
    settings,
    parsedAgentConcurrencyLimit,
    agentConcurrencyLimitValid,
    setAgentConcurrencyLimit,
  } = context;
  async function setLanguage(language: AppLanguage) {
    await context.run(async () => {
      const updated = await window.artemis.setLanguage(language);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setMaterial(material: MaterialPreference) {
    await context.run(async () => {
      const updated = await window.artemis.setMaterial(material);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setTheme(theme: AppTheme) {
    await context.run(async () => {
      const updated = await window.artemis.setTheme(theme);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setProfileAvatar(file: File | undefined) {
    await context.run(async () => {
      const avatar = file
        ? await prepareProfileAvatar(file, locale)
        : undefined;
      const updated = await window.artemis.setProfileAvatar(avatar);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setProfileName(name: string | undefined) {
    await context.run(async () => {
      const updated = await window.artemis.setProfileName(name);
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setShellRuntimeConfiguration(
    change:
      | { windowsPreference: WindowsShellPreference }
      | { profileMode: ShellProfileMode },
  ) {
    if (!settings) return;
    await context.run(async () => {
      const updated = await window.artemis.setShellRuntimeConfiguration({
        ...settings.shell,
        ...change,
      });
      setSettings(updated);
      onSettingsChange(updated);
    });
  }

  async function setAgentConcurrencyMode(mode: "auto" | "manual") {
    if (!settings) return;
    await context.run(async () => {
      const manualLimit = agentConcurrencyLimitValid
        ? parsedAgentConcurrencyLimit
        : settings.agentConcurrency.configuredLimit;
      const updated = await window.artemis.setAgentConcurrency(
        mode === "auto"
          ? { mode: "auto" }
          : { mode: "manual", limit: manualLimit },
      );
      setSettings(updated);
      setAgentConcurrencyLimit(
        String(
          updated.agentConcurrency.preference.mode === "manual"
            ? updated.agentConcurrency.preference.limit
            : updated.agentConcurrency.configuredLimit,
        ),
      );
      onSettingsChange(updated);
    });
  }

  async function applyAgentConcurrencyLimit() {
    if (!agentConcurrencyLimitValid) return;
    await context.run(async () => {
      const updated = await window.artemis.setAgentConcurrency({
        mode: "manual",
        limit: parsedAgentConcurrencyLimit,
      });
      setSettings(updated);
      onSettingsChange(updated);
    });
  }
  return {
    setLanguage,
    setMaterial,
    setTheme,
    setProfileAvatar,
    setProfileName,
    setShellRuntimeConfiguration,
    setAgentConcurrencyMode,
    applyAgentConcurrencyLimit,
  };
}
