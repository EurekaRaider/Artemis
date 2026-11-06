import type { HookQuery } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "hookCatalog" | "ipcMain" | "contextForHook" | "getHooksService"
>;

export function registerHooksIpc(services: Dependencies): void {
  const { hookCatalog, ipcMain, contextForHook, getHooksService } = services;

  ipcMain.handle(IPC.hooksList, async (_event, query: HookQuery = {}) =>
    hookCatalog(query),
  );
  ipcMain.handle(
    IPC.hooksTrust,
    async (
      _event,
      query: HookQuery,
      reviewed: Array<{ id: string; hash: string }>,
      scope: "all" | "project",
    ) => {
      if (
        !Array.isArray(reviewed) ||
        reviewed.length > 200 ||
        !["all", "project"].includes(scope)
      )
        throw new Error("Invalid hook trust request");
      // Validate every reviewed hash before committing any trust in a multi-project batch.
      const catalog = await hookCatalog(query);
      for (const review of reviewed)
        if (
          !catalog.hooks.some(
            (h) =>
              h.id === review.id &&
              h.hash === review.hash &&
              h.status !== "invalid",
          )
        )
          throw new Error("Hook changed since review");
      for (const review of reviewed)
        await getHooksService().trust(
          await contextForHook(query, review.id),
          [review],
          scope,
        );
    },
  );
  ipcMain.handle(
    IPC.hooksChange,
    async (
      _event,
      query: HookQuery,
      id: string,
      action: "enable" | "disable" | "revoke",
    ) => {
      if (!["enable", "disable", "revoke"].includes(action))
        throw new Error("Invalid hook action");
      await getHooksService().change(
        await contextForHook(query, id),
        id,
        action,
      );
    },
  );
  ipcMain.handle(
    IPC.hooksInspect,
    async (_event, query: HookQuery, id: string) =>
      getHooksService().inspect(await contextForHook(query, id), id),
  );
}
