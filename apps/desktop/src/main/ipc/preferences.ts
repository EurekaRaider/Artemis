import { parseMaterialPreference } from "../../shared/window-material.js";
import { open } from "node:fs/promises";
import { app } from "electron";
import { getPlatformContract, resolveShellRuntime } from "@artemis/platform";
import type {
  AppLanguage,
  AppTheme,
  ApprovalPolicy,
  ShellRuntimeConfiguration,
} from "@artemis/protocol";
import {
  appLanguageSchema,
  appThemeSchema,
  approvalPolicySchema,
  shellRuntimeConfigurationSchema,
} from "@artemis/protocol";
import {
  IPC,
  type AgentConcurrencyPreference,
  type SettingsSnapshot,
} from "../../shared/api.js";
import { resolveAppLocale } from "../../shared/i18n/locales.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "getSettingsSnapshot"
  | "ipcMain"
  | "settingsStore"
  | "languagePreference"
  | "resolvedLocalePreference"
  | "currentLocale"
  | "designPanelHost"
  | "sleepPrevention"
  | "materialPreference"
  | "syncWindowBackgroundColors"
  | "applyNativeTheme"
  | "appearanceService"
  | "activeTurns"
  | "trustedExtensionManager"
  | "resetAgentThreadsForToolChange"
  | "refreshTrustedExtensions"
  | "applyAgentRuntime"
  | "agentCapacityController"
  | "agentCapacityApplyTail"
  | "applyAgentCapacityChange"
>;

export function registerPreferencesIpc(services: Dependencies): void {
  const {
    getSettingsSnapshot,
    ipcMain,
    currentLocale,
    sleepPrevention,
    syncWindowBackgroundColors,
    applyNativeTheme,
    activeTurns,
    resetAgentThreadsForToolChange,
    refreshTrustedExtensions,
    applyAgentRuntime,
    applyAgentCapacityChange,
  } = services;

  ipcMain.handle(IPC.settingsGet, () => getSettingsSnapshot());
  ipcMain.handle(
    IPC.settingsProfileAvatarSet,
    async (_event, avatar: string | undefined): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      await services.settingsStore.setProfileAvatar(avatar);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsProjectOrderSet,
    async (_event, order: string[]): Promise<string[]> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setProjectOrder(order);
    },
  );
  ipcMain.handle(
    IPC.settingsProjectThreadOrderSet,
    async (_event, projectId: string, order: string[]): Promise<string[]> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setProjectThreadOrder(projectId, order);
    },
  );
  ipcMain.handle(
    IPC.settingsCollapsedProjectIdsSet,
    async (_event, projectIds: string[]): Promise<string[]> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setCollapsedProjectIds(projectIds);
    },
  );
  ipcMain.handle(
    IPC.settingsExpandedProjectIdsSet,
    async (_event, projectIds: string[]): Promise<string[]> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setExpandedProjectIds(projectIds);
    },
  );
  ipcMain.handle(
    IPC.settingsProjectSidebarWidthSet,
    async (_event, width: number): Promise<number> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setProjectSidebarWidth(width);
    },
  );
  ipcMain.handle(
    IPC.settingsTemporaryConversationsOpenSet,
    async (_event, open: boolean): Promise<boolean> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setTemporaryConversationsOpen(open);
    },
  );
  ipcMain.handle(
    IPC.settingsWorkspaceDockWidthSet,
    async (_event, width: number): Promise<number> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      return services.settingsStore.setWorkspaceDockWidth(width);
    },
  );
  ipcMain.handle(
    IPC.settingsLanguageSet,
    async (_event, value: AppLanguage): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const language = appLanguageSchema.parse(value);
      await services.settingsStore.setLanguagePreference(language);
      services.languagePreference = language;
      services.resolvedLocalePreference = resolveAppLocale(
        services.languagePreference,
        app.getPreferredSystemLanguages(),
      );
      services.designPanelHost?.setLocale(currentLocale());
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsComposerPredictionsSet,
    async (_event, enabled: boolean): Promise<SettingsSnapshot> => {
      if (!services.settingsStore)
        throw new Error("Agent settings are not ready.");
      await services.settingsStore.setComposerPredictionsPreference(enabled);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsPreventSleepSet,
    async (_event, enabled: boolean): Promise<SettingsSnapshot> => {
      if (!services.settingsStore)
        throw new Error("Agent settings are not ready.");
      await services.settingsStore.setPreventSleepPreference(enabled);
      sleepPrevention.setEnabled(enabled);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsMaterialSet,
    async (_event, value: unknown): Promise<SettingsSnapshot> => {
      if (!services.settingsStore)
        throw new Error("Agent settings are not ready.");
      const material = parseMaterialPreference(value);
      await services.settingsStore.setMaterialPreference(material);
      services.materialPreference = material;
      syncWindowBackgroundColors();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsThemeSet,
    async (_event, value: AppTheme): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      const theme = appThemeSchema.parse(value);
      await services.settingsStore.setThemePreference(theme);
      applyNativeTheme(theme);
      services.appearanceService?.setTheme(theme);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsApprovalPolicySet,
    async (_event, value: ApprovalPolicy): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (activeTurns.size > 0) {
        throw new Error(
          "Stop active turns before changing the approval policy.",
        );
      }
      const policy = approvalPolicySchema.parse(value);
      if (
        policy === "full-access" &&
        !getPlatformContract().sandbox.available
      ) {
        throw new Error(
          "Full access requires the platform-native sandbox to be available.",
        );
      }
      await services.settingsStore.setApprovalPolicy(policy);
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsLocalFullAccessSet,
    async (_event, enabled: boolean): Promise<SettingsSnapshot> => {
      if (!services.settingsStore || !services.trustedExtensionManager) {
        throw new Error("Agent settings are not ready.");
      }
      await resetAgentThreadsForToolChange();
      await services.settingsStore.setLocalFullAccess(Boolean(enabled));
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsShellRuntimeSet,
    async (
      _event,
      value: ShellRuntimeConfiguration,
    ): Promise<SettingsSnapshot> => {
      if (!services.settingsStore) {
        throw new Error("Agent settings are not ready.");
      }
      if (activeTurns.size > 0) {
        throw new Error("Stop active turns before changing shell settings.");
      }
      const configuration = shellRuntimeConfigurationSchema.parse(value);
      resolveShellRuntime({
        platform: process.platform,
        env: process.env,
        windowsPreference: configuration.windowsPreference,
      });
      await resetAgentThreadsForToolChange();
      await services.settingsStore.setShellRuntimeConfiguration(configuration);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.settingsAgentConcurrencySet,
    async (
      _event,
      preference: AgentConcurrencyPreference,
    ): Promise<SettingsSnapshot> => {
      if (!services.settingsStore || !services.agentCapacityController) {
        throw new Error("Agent capacity settings are not ready.");
      }
      await services.agentCapacityApplyTail;
      await services.settingsStore.setAgentConcurrencyPreference(preference);
      const change = services.agentCapacityController.setPreference(preference);
      await applyAgentCapacityChange(change);
      return getSettingsSnapshot();
    },
  );
}
