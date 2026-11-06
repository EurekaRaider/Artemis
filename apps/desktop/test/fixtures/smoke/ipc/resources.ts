import { IPC } from "../../../../src/shared/api.js";
import {
  mcpConfigStore,
  resourceCatalogService,
} from "../../../../src/main/main.js";
import { smokeMode } from "../environment.js";

export function decorateResourcesIpc(
  channel: string,
  next: Parameters<import("electron").IpcMain["handle"]>[1],
) {
  const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
  if (
    channel === IPC.resourceMcpSearch &&
    smokeMode &&
    view.startsWith("mcp-search-")
  )
    return async (_event: Electron.IpcMainInvokeEvent, query: string) => {
      if (!resourceCatalogService || !mcpConfigStore) {
        throw new Error("Resource catalog is not ready.");
      }
      if (smokeMode && process.env.ARTEMIS_SMOKE_VIEW === "mcp-search-empty") {
        return [];
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "mcp-search-loading"
      ) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 10_000),
        );
        return [];
      }
      return next(_event, query);
    };
  if (
    channel === IPC.resourceSkillSearch &&
    smokeMode &&
    view.startsWith("skill-search-")
  )
    return async (_event: Electron.IpcMainInvokeEvent, query: string) => {
      if (!resourceCatalogService) {
        throw new Error("Resource catalog is not ready.");
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "skill-search-empty"
      ) {
        return [];
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "skill-search-loading"
      ) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 10_000),
        );
        return [];
      }
      return next(_event, query);
    };
  return next;
}
