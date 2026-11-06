import { join } from "node:path";
import { app, BrowserWindow, type WebContents } from "electron";
import {
  IPC,
  type ArtemisPluginMutationResult,
  type ResourceInstallProgress,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "artemisPluginService"
  | "pluginsWithHookState"
  | "installedSkillsWithState"
  | "getSettingsSnapshot"
  | "settingsStore"
  | "trustedExtensionStore"
  | "trustedExtensionManager"
  | "mcpConfigStore"
  | "mcpClientManager"
  | "connectMcpServer"
  | "diagnosticBundleService"
  | "applyAgentRuntime"
>;
export function createPluginRuntime(services: Dependencies) {
  const {
    pluginsWithHookState,
    installedSkillsWithState,
    getSettingsSnapshot,
    connectMcpServer,
    applyAgentRuntime,
  } = services;
  async function artemisPluginMutationResult(
    warnings: string[],
  ): Promise<ArtemisPluginMutationResult> {
    if (!services.artemisPluginService) {
      throw new Error("Plugin service is not ready.");
    }
    return {
      plugins: await pluginsWithHookState(),
      skills: await installedSkillsWithState(),
      settings: await getSettingsSnapshot(),
      warnings,
    };
  }

  async function enableManagedPluginSkills(
    skillNames: string[],
  ): Promise<void> {
    if (!services.settingsStore)
      throw new Error("Agent settings are not ready.");
    for (const name of skillNames) {
      await services.settingsStore.setSkillEnabled(
        join(app.getPath("home"), ".pi", "agent", "skills", name, "SKILL.md"),
        true,
      );
    }
  }

  async function reconcileManagedPluginSkills(
    previousNames: string[],
    nextNames: string[],
    previousEnabled: ReadonlyMap<string, boolean>,
    newSkillsEnabled = true,
  ): Promise<void> {
    if (!services.settingsStore)
      throw new Error("Agent settings are not ready.");
    const next = new Set(nextNames);
    for (const name of previousNames) {
      if (next.has(name)) continue;
      await services.settingsStore.setSkillEnabled(
        join(app.getPath("home"), ".pi", "agent", "skills", name, "SKILL.md"),
        true,
      );
    }
    for (const name of nextNames) {
      await services.settingsStore.setSkillEnabled(
        join(app.getPath("home"), ".pi", "agent", "skills", name, "SKILL.md"),
        previousEnabled.get(name) ?? newSkillsEnabled,
      );
    }
  }

  function resourceInstallOperationId(input: unknown): string {
    const operationId = String(input ?? "").trim();
    if (!/^[A-Za-z0-9-]{1,128}$/u.test(operationId)) {
      throw new Error("Resource installation operation ID is invalid.");
    }
    return operationId;
  }

  function publishResourceInstallProgress(
    sender: WebContents,
    progress: ResourceInstallProgress,
  ): void {
    sender.send(IPC.resourceInstallProgress, {
      ...progress,
      percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
    });
  }

  function restoreResourceDialogFocus(sender: WebContents): void {
    const owner = BrowserWindow.fromWebContents(sender);
    if (!owner || owner.isDestroyed() || sender.isDestroyed()) return;
    owner.focus();
    sender.focus();
  }

  async function refreshTrustedExtensions(): Promise<void> {
    if (
      !services.trustedExtensionStore ||
      !services.trustedExtensionManager ||
      !services.settingsStore
    ) {
      throw new Error("Trusted extension service is not ready.");
    }
    await services.trustedExtensionManager.refresh(
      await services.trustedExtensionStore.list(),
      undefined,
      await services.settingsStore.localFullAccess(),
    );
  }

  async function initializeOptionalCapabilities(): Promise<void> {
    if (
      !services.mcpConfigStore ||
      !services.mcpClientManager ||
      !services.settingsStore
    ) {
      throw new Error("MCP services are not ready.");
    }
    const configurations = await services.mcpConfigStore.listAvailable();
    await Promise.all(
      configurations
        .filter((config) => config.enabled)
        .map(async (config) => {
          try {
            await connectMcpServer(config);
          } catch (error) {
            services.diagnosticBundleService?.record({
              source: "main",
              severity: "warning",
              message: `MCP server ${config.id} did not connect during startup: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        }),
    );
    try {
      await refreshTrustedExtensions();
    } catch (error) {
      services.diagnosticBundleService?.record({
        source: "main",
        severity: "warning",
        message: `Trusted extensions did not refresh during startup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    await applyAgentRuntime();
  }
  return {
    artemisPluginMutationResult,
    enableManagedPluginSkills,
    reconcileManagedPluginSkills,
    resourceInstallOperationId,
    publishResourceInstallProgress,
    restoreResourceDialogFocus,
    refreshTrustedExtensions,
    initializeOptionalCapabilities,
  };
}
