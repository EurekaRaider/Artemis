import { createDesignPackRuntime } from "../design/design-pack-runtime.js";
import { designPluginRevisionsRoot } from "../design/design-plugin-thread-data.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog } from "electron";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "getOfficeWorkbench"
  | "ipcMain"
  | "currentLocale"
  | "designPluginAvailabilityGate"
  | "designPanelHost"
  | "applyAgentRuntime"
>;

export function registerDesignCapabilityIpc(services: Dependencies) {
  const { getOfficeWorkbench, ipcMain, currentLocale, applyAgentRuntime } =
    services;

  // Design capability pack (todo ⑤): the settings toggle's backend. Mirrors
  // the office capability surface namespaced to packId "artemis-design".
  let designPackRuntime: ReturnType<typeof createDesignPackRuntime> | undefined;
  const getDesignPackRuntime = () => {
    designPackRuntime ??= createDesignPackRuntime({
      userData: app.getPath("userData"),
      catalogPath:
        process.env.ARTEMIS_DESIGN_PACK_CATALOG ??
        (app.isPackaged
          ? join(
              process.resourcesPath,
              "resources",
              "design-plugins",
              "catalog.json",
            )
          : join(
              app.getAppPath(),
              "resources",
              "design-plugins",
              "catalog.json",
            )),
      hostVersion: app.getVersion(),
      revisionsRoot: designPluginRevisionsRoot(app.getPath("userData")),
    });
    return designPackRuntime;
  };
  /** Install/activate must land the payload in the thread-binding trust chain. */
  type DesignRevisionSync =
    | { installationId: string; contentHash: string; revisionRoot: string }
    | undefined;
  const syncDesignPackRevision = async (): Promise<DesignRevisionSync> => {
    try {
      const result = await (await getDesignPackRuntime()).syncActiveRevision();
      if (result) {
        // Follow-the-active-revision（一方插件语义）：本安装的所有绑定线程
        // 统一迁到新修订（改绑定哈希/版本 + 补授权），面板与工具链随 pack
        // 更新即时跟进；修订库不可变，老修订内容原地保留。
        const manifest = JSON.parse(
          await readFile(
            join(result.revisionRoot, "artemis.plugin.json"),
            "utf8",
          ),
        ) as { id: string; version: string };
        const binding = {
          installationId: result.installationId,
          pluginId: result.installationId,
          typeId: "artemis-design",
          pluginVersion: manifest.version,
          contentHash: result.contentHash,
          bindingRevision: `rev-${result.contentHash.slice(0, 12)}`,
        };
        for (const thread of services.store?.listThreads() ?? []) {
          if (thread.typeBinding?.installationId !== result.installationId)
            continue;
          if (thread.typeBinding.contentHash === result.contentHash) continue;
          services.store?.updateThread(thread.id, { typeBinding: binding });
          services.store?.insertPluginGrant({
            grantId: randomUUID(),
            installationId: binding.installationId,
            pluginId: binding.pluginId,
            contentHash: binding.contentHash,
            scope: "thread",
            scopeId: thread.id,
            capabilities: { artifactStore: "thread" },
            resourceRefs: {
              revisionsRoot: designPluginRevisionsRoot(app.getPath("userData")),
            },
            grantRevision: binding.bindingRevision,
          });
        }
      }
      // New design tasks must bind to the revision just installed as well.
      designPackSyncedRevision = result;
      return result;
    } catch (error) {
      console.error("[design-pack] revision sync failed", error);
      return undefined;
    }
  };
  // An install from a previous run leaves the pack active but its payload
  // possibly unpublished (crash between install and sync); lazily reconcile
  // once per process on the first status read. Idempotent and cheap.
  let designPackSyncedThisRun = false;
  let designPackSyncedRevision: DesignRevisionSync;
  const ensureDesignPackSynced = async (): Promise<DesignRevisionSync> => {
    // Only a successful sync is cached; an undefined result (pack absent or
    // not yet installed) retries on the next ensure so an install later in
    // the same process publishes instead of serving the stale miss.
    if (designPackSyncedThisRun && designPackSyncedRevision)
      return designPackSyncedRevision;
    designPackSyncedThisRun = true;
    designPackSyncedRevision = await syncDesignPackRevision();
    return designPackSyncedRevision;
  };
  void getOfficeWorkbench().catch((error) =>
    console.error("[office] startup reconciliation failed", error),
  );
  // Reconcile an upgraded host even when the user never opens the store.
  void ensureDesignPackSynced().catch((error) =>
    console.error("[design-pack] startup reconciliation failed", error),
  );
  ipcMain.handle(IPC.designCapabilityStatus, async () => {
    await ensureDesignPackSynced();
    return (await getDesignPackRuntime()).status();
  });
  /** Entry-visibility seed: whether the pack is active right now. */
  ipcMain.handle(IPC.designCapabilityAvailability, async () => {
    await ensureDesignPackSynced();
    const status = await (await getDesignPackRuntime()).status();
    return { available: Boolean(status.activeVersion) };
  });
  /**
   * Why the design plugin is currently unusable for a thread, or null when
   * usable. A thread WITH a type binding (every real design task) requires
   * the capability pack: removing the pack hides design mode even though
   * the bound revision survives on disk (reinstalling restores it in place,
   * zero data movement). Only the unbound dev/catalog path falls back to the
   * bundled resources.
   */
  const designPluginUnavailableReason = async (
    threadId?: string,
  ): Promise<string | null> => {
    const bound = threadId
      ? Boolean(services.store?.getThread(threadId)?.typeBinding)
      : true;
    try {
      await ensureDesignPackSynced();
      const status = await (await getDesignPackRuntime()).status();
      if (status.activeVersion) return null;
    } catch {
      // Catalog problems fall through to the bundled-resource check below.
    }
    if (!bound) {
      const bundled = join(
        app.getAppPath(),
        "resources",
        "design-plugins",
        "artemis-design",
        "artemis.plugin.json",
      );
      try {
        await readFile(bundled);
        return null;
      } catch {
        /* fall through to the removal message */
      }
    }
    return uiText(currentLocale(), "DesignHost.pluginRemoved");
  };
  services.designPluginAvailabilityGate = designPluginUnavailableReason;
  /** Entry visibility + tab lifecycle follow the pack: broadcast on change. */
  const broadcastDesignAvailability = async () => {
    try {
      const status = await (await getDesignPackRuntime()).status();
      const available = Boolean(status.activeVersion);
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        window.webContents.send(IPC.designCapabilityAvailability, {
          available,
        });
      }
    } catch (error) {
      console.error("[design-pack] availability broadcast failed", error);
    }
  };
  /** Remove = design mode off: close every open panel of the plugin. */
  const closeDesignPanels = (threadId?: string) => {
    if (!services.designPanelHost) return;
    const threads = threadId
      ? [threadId]
      : [
          ...new Set(
            services.store?.listThreads().map((thread) => thread.id) ?? [],
          ),
        ];
    for (const id of threads) {
      for (const handle of services.designPanelHost.listPanels(id)) {
        services.designPanelHost.releasePanel(id, handle.panelId);
      }
    }
  };
  ipcMain.handle(IPC.designCapabilityCheckUpdates, async () => {
    await (await getDesignPackRuntime()).updates.check();
  });
  /** Map trust-chain failures to actionable user language. */
  const translateDesignPackError = (error: unknown): Error => {
    const message = error instanceof Error ? error.message : String(error);
    if (/Untrusted capability signing key/.test(message))
      return new Error(uiText(currentLocale(), "DesignHost.untrustedPack"));
    if (/No verified design plugin release/.test(message))
      return new Error(
        uiText(currentLocale(), "DesignHost.releaseUnavailable"),
      );
    return error instanceof Error ? error : new Error(message);
  };
  ipcMain.handle(IPC.designCapabilityInstall, async () => {
    const runtime = await getDesignPackRuntime();
    const manifest = runtime.updates.available();
    if (!manifest)
      throw new Error(uiText(currentLocale(), "DesignHost.releaseUnavailable"));
    try {
      await runtime.packs.install(manifest);
    } catch (error) {
      throw translateDesignPackError(error);
    }
    await syncDesignPackRevision();
    await broadcastDesignAvailability();
  });
  ipcMain.handle(
    IPC.designCapabilityImport,
    async (_event, input?: { path?: string }) => {
      // Explicit path (drag-and-drop import / automation) skips the picker;
      // installOffline verifies the container signature either way.
      const explicit = input?.path;
      if (explicit) {
        try {
          await (
            await getDesignPackRuntime()
          ).packs.installOffline(String(explicit));
        } catch (error) {
          throw translateDesignPackError(error);
        }
        await syncDesignPackRevision();
        await broadcastDesignAvailability();
        return;
      }
      const selected = await dialog.showOpenDialog({
        title: "Import design plugin offline pack",
        properties: ["openFile"],
        filters: [
          { name: "Design plugin pack", extensions: ["artemis-design"] },
        ],
      });
      if (selected.canceled || !selected.filePaths[0]) return;
      try {
        await (
          await getDesignPackRuntime()
        ).packs.installOffline(selected.filePaths[0]);
        await applyAgentRuntime();
      } catch (error) {
        throw translateDesignPackError(error);
      }
      await syncDesignPackRevision();
      await broadcastDesignAvailability();
    },
  );
  ipcMain.handle(IPC.designCapabilityCancel, async () =>
    (await getDesignPackRuntime()).packs.cancel(),
  );
  ipcMain.handle(
    IPC.designCapabilityActivate,
    async (_event, version: string) => {
      await (await getDesignPackRuntime()).packs.activate(version);
      await syncDesignPackRevision();
      await broadcastDesignAvailability();
    },
  );
  ipcMain.handle(IPC.designCapabilityDeactivate, async () => {
    await (await getDesignPackRuntime()).packs.deactivate();
    // Design mode is off: open panels must go with it.
    closeDesignPanels();
    await broadcastDesignAvailability();
  });
  ipcMain.handle(
    IPC.designCapabilityUninstall,
    async (_event, version?: string) => {
      await (await getDesignPackRuntime()).packs.uninstall(version);
      // Design mode is off: open panels must go with it. Revisions (and with
      // them every thread's files and history) stay on disk.
      closeDesignPanels();
      await broadcastDesignAvailability();
    },
  );
  return { ensureDesignPackSynced };
}
