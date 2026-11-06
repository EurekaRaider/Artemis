import { isExecutionMode } from "@artemis/protocol";
import {
  validateCustomAgentInput,
  validateCustomAgentToolPolicy,
} from "../settings/custom-agent-validation.js";
import type { CustomAgentDefinition, RunMode } from "@artemis/protocol";
import { computeEffectiveCapabilities } from "@artemis/protocol";
import {
  CUSTOM_AGENT_CHILD_BASELINE,
  resolveCustomAgentToolCapabilities,
} from "@artemis/agent-host/custom-agent-capabilities";
import {
  IPC,
  type CustomAgentCapabilityPreview,
  type SettingsSnapshot,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "globalInstructionsStore"
  | "resetAgentThreadsForToolChange"
  | "applyAgentRuntime"
  | "getSettingsSnapshot"
  | "ipcMain"
  | "store"
  | "mcpClientManager"
>;

export function registerCustomAgentsIpc(services: Dependencies): void {
  const {
    resetAgentThreadsForToolChange,
    applyAgentRuntime,
    getSettingsSnapshot,
    ipcMain,
  } = services;

  ipcMain.handle(
    IPC.settingsGlobalAgentsSave,
    async (_event, content: string): Promise<SettingsSnapshot> => {
      if (!services.globalInstructionsStore) {
        throw new Error("Global instructions are not ready.");
      }
      await resetAgentThreadsForToolChange();
      await services.globalInstructionsStore.save(content);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.customAgentsGet,
    (_event, id: string): CustomAgentDefinition | undefined => {
      if (!services.store) throw new Error("Application store is not ready.");
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("CUSTOM_AGENT_INVALID: id is required");
      }
      // Editor-only endpoint: the one place renderers may read dedicated
      // instructions. Catalogs, logs, and diagnostics never see them.
      return services.store.getCustomAgent(id);
    },
  );
  ipcMain.handle(
    IPC.customAgentsCreate,
    async (_event, raw: unknown): Promise<SettingsSnapshot> => {
      const appStore = services.store;
      if (!appStore) throw new Error("Application store is not ready.");
      const input = validateCustomAgentInput(raw, (projectId) =>
        Boolean(appStore.getProject(projectId)),
      );
      appStore.createCustomAgent(input);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.customAgentsUpdate,
    async (
      _event,
      id: string,
      expectedRevision: number,
      raw: unknown,
    ): Promise<SettingsSnapshot> => {
      const appStore = services.store;
      if (!appStore) throw new Error("Application store is not ready.");
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("CUSTOM_AGENT_INVALID: id is required");
      }
      if (
        typeof expectedRevision !== "number" ||
        !Number.isInteger(expectedRevision) ||
        expectedRevision < 1
      ) {
        throw new Error(
          "CUSTOM_AGENT_INVALID: expectedRevision must be a positive integer",
        );
      }
      const input = validateCustomAgentInput(raw, (projectId) =>
        Boolean(appStore.getProject(projectId)),
      );
      appStore.updateCustomAgent(id, expectedRevision, input);
      // Revocation push: disabled/deleted definitions cancel not-yet-
      // started instances inside the worker via reconcile on configure.
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.customAgentsDelete,
    async (_event, id: string): Promise<SettingsSnapshot> => {
      if (!services.store) throw new Error("Application store is not ready.");
      if (typeof id !== "string" || id.length === 0) {
        throw new Error("CUSTOM_AGENT_INVALID: id is required");
      }
      services.store.deleteCustomAgent(id);
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.customAgentsPreviewCapabilities,
    (_event, raw: unknown, mode: RunMode): CustomAgentCapabilityPreview => {
      if (!isExecutionMode(mode) && mode !== "plan") {
        throw new Error("CUSTOM_AGENT_INVALID: unknown run mode");
      }
      const input = raw as { toolPolicy?: unknown } | null | undefined;
      const toolPolicy = validateCustomAgentToolPolicy(input?.toolPolicy);
      const liveGrants = new Set(CUSTOM_AGENT_CHILD_BASELINE);
      if ((services.mcpClientManager?.tools() ?? []).length === 0) {
        liveGrants.delete("mcp");
      }
      const capabilities = computeEffectiveCapabilities(
        {
          runMode: mode,
          childBaseline: CUSTOM_AGENT_CHILD_BASELINE,
          // Root-parent preview: the parent may pass down the full child
          // baseline. Per-instance intersections can only shrink from here.
          parentDelegatable: CUSTOM_AGENT_CHILD_BASELINE,
          liveGrants,
        },
        toolPolicy,
        resolveCustomAgentToolCapabilities,
      );
      return { mode, capabilities: [...capabilities].sort() };
    },
  );
}
