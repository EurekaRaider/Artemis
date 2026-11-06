import { isExecutionMode } from "@artemis/protocol";
import { join } from "node:path";
import { app } from "electron";
import { createOfficeWorkbench } from "../office/office-workbench.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "officeWorkbench"
  | "store"
  | "artemisPluginService"
  | "activeTurns"
  | "emitPayload"
  | "applyAgentRuntime"
>;
export function createOfficeRuntime(services: Dependencies) {
  const { activeTurns, emitPayload, applyAgentRuntime } = services;
  function getOfficeWorkbench(): ReturnType<typeof createOfficeWorkbench> {
    services.officeWorkbench ??= createOfficeWorkbench({
      userData: app.getPath("userData"),
      catalogPath: app.isPackaged
        ? join(
            process.resourcesPath,
            "resources",
            "office-runtime",
            "catalog.json",
          )
        : join(app.getAppPath(), "resources", "office-runtime", "catalog.json"),
      hostVersion: app.getVersion(),
      canAutoSave: (threadId) => {
        const thread = services.store?.getThread(threadId);
        return !!thread && !thread.archived && isExecutionMode(thread.mode);
      },
      dependents: async (version) =>
        ((await services.artemisPluginService?.listInstalled()) ?? [])
          .filter((plugin) =>
            plugin.capabilityDependencies?.some(
              (dependency) =>
                dependency.id === "office-core" &&
                dependency.version === version,
            ),
          )
          .map((plugin) => plugin.displayName),
      emit: (threadId, event) =>
        emitPayload(threadId, activeTurns.get(threadId), {
          type: "artifact.event",
          event,
        }),
    });
    return services.officeWorkbench;
  }

  async function installOfficeSuite(): Promise<void> {
    const workbench = await getOfficeWorkbench();
    const manifest = workbench.updates.available();
    if (!manifest)
      throw new Error(
        "No verified Office suite release is available for this platform yet. Import a verified offline pack to enable Office features.",
      );
    await workbench.packs.install(manifest);
    await applyAgentRuntime();
  }
  return { getOfficeWorkbench, installOfficeSuite };
}
