import { readFileSync as readStartupFile } from "node:fs";
import { createDesignHandoffHandler } from "../design/design-plugin-handoff.js";
import {
  closeWorkspaceTabMenu,
  setWorkspaceTabMenuHandlers,
  showWorkspaceTabMenu,
  workspaceTabMenuParent,
} from "../workspace/workspace-tab-menu-window.js";
import { designPluginRevisionsRoot } from "../design/design-plugin-thread-data.js";
import { isExecutionMode } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";
import {
  readProjectFileForPreview,
  readWorkspaceFileBytes,
  scanProjectDesignFiles,
  readDesignImage,
  DESIGN_IMAGE_MIME,
} from "../design/design-plugin-project-files.js";
import {
  listDesignThinVersions,
  recordDesignThinSnapshot,
  restoreDesignThinVersion,
  resolveDesignWorkspacePath,
} from "../design/design-thin-snapshots.js";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "linkedWorkspaceFile"
  | "getOfficeWorkbench"
  | "workspacePdfPreview"
  | "ipcMain"
  | "mainWindow"
  | "workspaceVideoPreview"
  | "currentLocale"
  | "designPanelHost"
  | "store"
  | "designPluginAvailabilityGate"
  | "tightenThreadToRestrictedProfile"
  | "panelSendEntry"
  | "pluginDispatch"
  | "designArtifactWriteSink"
  | "resolveThreadWorkspace"
  | "workspaceHtmlPreview"
>;

export function registerWorkspacePreviewIpc(
  services: Dependencies,
  ensureDesignPackSynced: ReturnType<
    typeof import("./design-capability.js").registerDesignCapabilityIpc
  >["ensureDesignPackSynced"],
): void {
  const {
    linkedWorkspaceFile,
    getOfficeWorkbench,
    workspacePdfPreview,
    ipcMain,
    workspaceVideoPreview,
    currentLocale,
    tightenThreadToRestrictedProfile,
    resolveThreadWorkspace,
    workspaceHtmlPreview,
  } = services;

  ipcMain.handle(
    IPC.workspacePdfOpen,
    async (_event, threadId: string, path: string) => {
      const file = await linkedWorkspaceFile(
        String(threadId ?? ""),
        String(path ?? ""),
      );
      if (!/\.pdf$/iu.test(file.path))
        throw new Error("PDF preview requires a PDF file.");
      if (!(await (await getOfficeWorkbench()).status()).activeVersion)
        throw new Error(
          "Install the Office suite in Plugins to preview documents.",
        );
      return workspacePdfPreview.open(threadId, file.path);
    },
  );
  const assertWorkspacePreviewSender = (event: Electron.IpcMainInvokeEvent) => {
    if (
      !services.mainWindow ||
      event.sender !== services.mainWindow.webContents ||
      event.senderFrame !== services.mainWindow.webContents.mainFrame
    )
      throw new Error("Workspace preview requires the application window.");
  };
  ipcMain.handle(
    IPC.workspaceVideoOpen,
    async (event, threadId: string, href: string) => {
      assertWorkspacePreviewSender(event);
      if (typeof threadId !== "string" || typeof href !== "string")
        throw new Error("Invalid video request.");
      return workspaceVideoPreview.open(threadId, href);
    },
  );
  ipcMain.handle(
    IPC.workspaceVideoRelease,
    (event, threadId: string, url: string) => {
      assertWorkspacePreviewSender(event);
      workspaceVideoPreview.release(threadId, url);
    },
  );
  ipcMain.handle(
    IPC.designPanelEnsure,
    async (event, threadId: string, panelId: string) => {
      if (!services.designPanelHost)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store?.getThread(threadId);
      if (!thread)
        throw new Error(
          uiText(currentLocale(), "DesignHost.activeTaskMissing"),
        );
      // 设计模式属于项目：临时会话没有稳定工作区（文件身份/薄快照都
      // 无处落），宿主侧直接拒绝（渲染器入口同样收窄）。
      if (!thread.projectId)
        throw new Error(uiText(currentLocale(), "DesignHost.projectOnly"));
      // Removal gate: an uninstalled plugin must not mount, even though its
      // bound revision survives on disk (reinstall restores it in place).
      const unavailable =
        await services.designPluginAvailabilityGate?.(threadId);
      if (unavailable) throw new Error(unavailable);
      // S2: verify the thread's revision binding before mounting; a
      // tampered revision refuses the load with a repair hint.
      const boundThread = services.store?.getThread(threadId);
      if (boundThread?.typeBinding) {
        const revisionRoot = join(
          designPluginRevisionsRoot(app.getPath("userData")),
          boundThread.typeBinding.installationId,
          boundThread.typeBinding.contentHash,
        );
        await services.designPanelHost.setThreadBinding({
          threadId,
          installationId: boundThread.typeBinding.installationId,
          contentHash: boundThread.typeBinding.contentHash,
          revisionRoot,
        });
      } else {
        // 打开面板即绑定：临时会话/普通项目线程首次使用设计面板时，冻结到
        // 当前激活的 pack 修订（持久化 binding + thread 授权），使面板与
        // 工具链在同一信任链上工作。移除插件时由可用性 gate 统一拒绝。
        const synced = await ensureDesignPackSynced();
        if (!synced)
          throw new Error(uiText(currentLocale(), "DesignHost.pluginMissing"));
        const manifest = JSON.parse(
          await readFile(
            join(synced.revisionRoot, "artemis.plugin.json"),
            "utf8",
          ),
        ) as { id: string; version: string };
        const binding = {
          installationId: synced.installationId,
          pluginId: synced.installationId,
          typeId: "artemis-design",
          pluginVersion: manifest.version,
          contentHash: synced.contentHash,
          bindingRevision: `rev-${synced.contentHash.slice(0, 12)}`,
        };
        services.store?.updateThread(threadId, { typeBinding: binding });
        services.store?.insertPluginGrant({
          grantId: randomUUID(),
          installationId: binding.installationId,
          pluginId: binding.pluginId,
          contentHash: binding.contentHash,
          scope: "thread",
          scopeId: threadId,
          capabilities: { artifactStore: "thread" },
          resourceRefs: {
            revisionsRoot: designPluginRevisionsRoot(app.getPath("userData")),
          },
          grantRevision: binding.bindingRevision,
        });
        // P1-5：绑定即收紧——普通会话立刻换受限会话（原子关闭+重开），
        // 而不是等下一次 app 启动才生效。
        await tightenThreadToRestrictedProfile(threadId);
        await services.designPanelHost.setThreadBinding({
          threadId,
          installationId: binding.installationId,
          contentHash: binding.contentHash,
          revisionRoot: synced.revisionRoot,
        });
      }
      services.designPanelHost.setLocale(currentLocale());
      const handle = await services.designPanelHost.ensurePanel(
        window,
        threadId,
        panelId,
      );
      // S4: push an initial snapshot so the panel can render the file list
      // and load the head document without waiting for a renderer event.
      // （首推可能早于面板脚本/port 握手就绪而丢：3s 后无条件补推一次，
      // 快照推送幂等；面板侧 snapshot-request 是另一重兜底。）
      void pushDesignSnapshot(threadId, panelId);
      // 补推兜底只兜"首推在 port 握手前丢失"：面板收到并渲染首份快照会
      // 回 snapshot-ack，已 ack 则无需再推（避免重复渲染闪烁）。
      setTimeout(() => {
        if (services.designPanelHost?.hasAckedSnapshot(threadId, panelId))
          return;
        void pushDesignSnapshot(threadId, panelId);
      }, 3000);
      // Theme follows the host: the panel is a separate webContents and
      // cannot observe the parent window's data-theme attribute.
      services.designPanelHost.pushTheme(
        threadId,
        panelId,
        nativeTheme.shouldUseDarkColors ? "dark" : "light",
      );
      return handle;
    },
  );
  ipcMain.handle(
    IPC.designPanelBounds,
    async (
      _event,
      threadId: string,
      panelId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => {
      services.designPanelHost?.setBounds(threadId, panelId, bounds);
    },
  );
  ipcMain.handle(
    IPC.designPanelVisible,
    async (_event, threadId: string, panelId: string, visible: boolean) => {
      services.designPanelHost?.setVisible(threadId, panelId, visible);
    },
  );
  ipcMain.handle(
    IPC.designPanelRelease,
    async (_event, threadId: string, panelId: string) => {
      services.designPanelHost?.releasePanel(threadId, panelId);
    },
  );
  // S3 host send entry (proposal §9.2): candidates never reach Pi from the
  // panel; the user consumes a one-time credential in the renderer to move
  // the text into the composer through the ledger state machine.
  ipcMain.handle(
    IPC.designPanelCandidateAccept,
    async (_event, threadId: string, candidateText: string) => {
      if (!services.store || !services.panelSendEntry)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store.getThread(threadId);
      const bindingRevision =
        thread?.typeBinding?.bindingRevision ?? "unbound-preview";
      const accepted = services.panelSendEntry.acceptCandidate({
        threadId,
        candidateText,
        bindingRevision,
      });
      return {
        threadId: accepted.threadId,
        candidateText: accepted.candidateText,
        credential: accepted.credential,
        submissionId: accepted.submission.submissionId,
      };
    },
  );
  ipcMain.handle(
    IPC.designPanelSendConsume,
    async (_event, credential: string) => {
      if (!services.panelSendEntry)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      try {
        const consumed = services.panelSendEntry.consumeCredential(credential);
        return {
          threadId: consumed.threadId,
          candidateText: consumed.candidateText,
          submissionId: credential.split(".")[0] ?? "",
        };
      } catch (error) {
        throw new Error(
          `Send credential refused: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );
  // （历史 S4 直连 IPC 的 export/handoff 处理器已删除：面板统一走 port
  // request handlers（designPanelHost.setRequestHandlers），那里有完整的
  // documentId 校验与安全读取；重复保留两条路径只会留下第二攻击面。）
  // P2-10：「加入输入框」走 staged 语义（accepted → cancelled），不再把
  // 未发送的草稿推进 dispatching。
  ipcMain.handle(
    IPC.designPanelSendStage,
    async (_event, credential: string) => {
      if (!services.panelSendEntry)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      try {
        const staged = services.panelSendEntry.stageCredential(credential);
        return {
          threadId: staged.threadId,
          candidateText: staged.candidateText,
          submissionId: credential.split(".")[0] ?? "",
        };
      } catch (error) {
        throw new Error(
          `Send credential refused: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );
  ipcMain.handle(
    IPC.designPanelSendOutcome,
    async (_event, submissionId: string, outcome: "completed" | "failed") => {
      services.panelSendEntry?.markOutcome(submissionId, outcome);
    },
  );
  // 图片创作：用户指定图片产出目录（项目工作区内或临时会话目录），选择
  // 一次后持久记住（跨重启）。图片扫描与读取复用设计项目文件的安全模型。
  const designImagePrefsPath = join(
    app.getPath("userData"),
    "design-image-prefs.json",
  );
  let designImageDir: string | undefined = (() => {
    try {
      const raw = readStartupFile(designImagePrefsPath, "utf8");
      const parsed = JSON.parse(raw) as { imageDir?: string };
      return typeof parsed.imageDir === "string" ? parsed.imageDir : undefined;
    } catch {
      return undefined;
    }
  })();
  // S4: snapshot downlink — the panel renders its file list from this.
  async function pushDesignSnapshot(
    threadId: string,
    panelId: string,
  ): Promise<void> {
    if (!services.pluginDispatch || !services.designPanelHost) return;
    // First-open dispatch can race runtime worker startup; one deferred
    // retry covers the "Worker not ready" window instead of leaving the
    // panel blank forever.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const delivered = await deliverDesignSnapshot(threadId, panelId);
      if (delivered) return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  services.designArtifactWriteSink = (threadId) => {
    pushDesignSnapshotDebounced(threadId, "workspace");
  };

  // Artifact writes arrive in bursts (one turn can apply several edits);
  // coalesce to a single trailing snapshot push per thread.
  const designSnapshotPushTimers = new Map<string, NodeJS.Timeout>();
  function pushDesignSnapshotDebounced(
    threadId: string,
    panelId: string,
  ): void {
    const existing = designSnapshotPushTimers.get(threadId);
    if (existing) clearTimeout(existing);
    designSnapshotPushTimers.set(
      threadId,
      setTimeout(() => {
        designSnapshotPushTimers.delete(threadId);
        void pushDesignSnapshot(threadId, panelId);
      }, 250),
    );
  }

  async function deliverDesignSnapshot(
    threadId: string,
    panelId: string,
  ): Promise<boolean> {
    if (!services.designPanelHost) return false;
    const thread = services.store?.getThread(threadId);
    const project = thread?.projectId
      ? services.store?.getProject(thread.projectId)
      : undefined;
    // 设计目标=工作区文件（无托管账本）：清单来自工作区扫描；
    // 显式选入的文件（从项目打开）永远保留并在去重时优先。
    let projectFiles = selectedDesignProjectFiles.get(threadId) ?? [];
    if (thread?.projectId) {
      try {
        const workspace = await resolveThreadWorkspace(thread);
        const scanned = await scanProjectDesignFiles(workspace.workspacePath);
        const selected = new Set(projectFiles.map((file) => file.path));
        projectFiles = [
          ...projectFiles,
          ...scanned.filter((file) => !selected.has(file.path)),
        ];
      } catch (error) {
        console.error("[design-panel] project scan failed", error);
      }
    }
    // 图片创作目录快照：记住的目录 + 其中图片清单（同名同形与项目文件行）。
    const imageDir = designImageDir;
    let images: Array<{ path: string; bytes: number; updatedAt: string }> = [];
    if (imageDir) {
      images = await scanProjectDesignFiles(imageDir, true);
    }
    services.designPanelHost.pushSnapshot(threadId, panelId, {
      documents: [],
      projectFiles,
      imageDir: imageDir ?? null,
      images,
      canOpenProject: Boolean(thread?.projectId),
      projectName:
        project?.name ?? uiText(currentLocale(), "DesignHost.designTask"),
    });
    return true;
  }

  // P1-3：项目文件读取管线已抽出为 design-plugin-project-files.ts
  //（readProjectFileForPreview），见其内注释的安全模型。

  // Only files explicitly selected for this task belong in the design panel.
  const selectedDesignProjectFiles = new Map<
    string,
    Array<{ path: string; bytes: number; updatedAt: string }>
  >();

  // 面板就绪后主动拉完整快照：首开的 host push 可能早于 port 握手而丢失
  //（白屏无卡片），面板发 snapshot-request 时补推。
  services.designPanelHost?.onSnapshotRequest(({ threadId, panelId }) => {
    void pushDesignSnapshot(threadId, panelId);
  });

  /**
   * P2-13：统一 HEAD 语义。runtime 的撤销只回拨 HEAD 指针（append-only 版
   * 本目录不动），数值序最后一个是「被撤销掉的未来」。预览/导出/截图/恢
   * 复兜底一律按 HEAD 选版本，无指针时回退数值序最后（runtime headVersion
   * 同构）。
   */

  /** 导出文件名净化：路径压平成安全文件名（上游 exportProjectFile 用）。 */
  function sanitizeDesignExportName(name: string): string {
    const base = basename(name.replace(/\\/g, "/")).trim();
    if (!base || base === "." || base === "..") return "design-document.html";
    return /\.html?$/i.test(base) ? base : `${base}.html`;
  }

  services.designPanelHost?.setRequestHandlers({
    /** 项目页面导出：原始 HTML 经保存对话框落盘（安全读取=预览同管线，
     * 但不做内联——导出的是用户工作区里的原文）。 */
    exportProjectFile: async (input) => {
      if (!services.store)
        return { error: uiText(currentLocale(), "DesignHost.hostUnavailable") };
      const thread = services.store.getThread(input.threadId);
      if (!thread)
        return {
          error: uiText(currentLocale(), "DesignHost.activeTaskMissing"),
        };
      const workspace = await resolveThreadWorkspace(thread);
      try {
        const read = await readProjectFileForPreview({
          locale: currentLocale(),
          workspacePath: workspace.workspacePath,
          requestedPath: String(input.path ?? ""),
        });
        void read;
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const parent =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      const save = parent
        ? await dialog.showSaveDialog(parent, {
            defaultPath: sanitizeDesignExportName(String(input.path ?? "")),
            filters: [{ name: "HTML", extensions: ["html"] }],
          })
        : { canceled: true, filePath: "" as string | undefined };
      if (save.canceled || !save.filePath) return { canceled: true };
      const raw = await readWorkspaceFileBytes(
        (await realpath(workspace.workspacePath).catch(() => undefined)) ??
          workspace.workspacePath,
        join(workspace.workspacePath, String(input.path ?? "")),
        4 * 1024 * 1024,
      );
      if (!raw)
        return { error: uiText(currentLocale(), "DesignHost.readFailed") };
      await writeFile(save.filePath, raw.bytes);
      return { path: save.filePath };
    },
    /** 图片创作：弹目录选择对话框并持久记住。 */
    pickImageFolder: async () => {
      const parent =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      const result = parent
        ? await dialog.showOpenDialog(parent, {
            title: uiText(currentLocale(), "DesignHost.chooseImageFolder"),
            properties: ["openDirectory", "createDirectory"],
          })
        : { canceled: true, filePaths: [] };
      if (result.canceled || !result.filePaths[0]) return {};
      const real = await realpath(result.filePaths[0]).catch(() => undefined);
      if (!real)
        return { error: uiText(currentLocale(), "DesignHost.folderMissing") };
      designImageDir = real;
      await writeFile(
        designImagePrefsPath,
        JSON.stringify({ imageDir: real }, null, 2),
      ).catch(() => undefined);
      return { imageDir: real };
    },
    /** 图片读取成 dataURL：`image-dir:`/`image-view:` 前缀=图片创作记住
     * 目录，`project:` 前缀=任务工作区（图片 tab 预览卡）。安全边界：
     * realpath 后必须仍在对应根内，O_NOFOLLOW 打开，2 MiB 上限，MIME
     * 白名单与图片扫描一致。 */
    readImage: async (input) => {
      const raw = String(input.path ?? "");
      const projectRel = /^project:(.+)$/.exec(raw)?.[1];
      let rootReal: string | undefined;
      let rel: string;
      if (projectRel !== undefined) {
        rel = projectRel.trim();
        const thread = input.threadId
          ? services.store?.getThread(input.threadId)
          : undefined;
        if (!thread?.projectId) return {};
        const workspace = await resolveThreadWorkspace(thread);
        rootReal = await realpath(workspace.workspacePath).catch(
          () => undefined,
        );
      } else {
        if (!designImageDir) return {};
        const dataUrl = await readDesignImage(designImageDir, raw);
        return dataUrl ? { dataUrl } : {};
      }
      if (!rootReal) return {};
      if (!rel || rel.includes("..") || rel.startsWith("/")) return {};
      const target = resolve(rootReal, rel);
      const read = await readWorkspaceFileBytes(
        rootReal,
        target,
        2 * 1024 * 1024,
      );
      if (!read) return {};
      const ext = extname(rel).toLowerCase();
      const mime = DESIGN_IMAGE_MIME[ext];
      if (!mime) return {};
      return {
        dataUrl: `data:${mime};base64,${read.bytes.toString("base64")}`,
      };
    },
    /** 项目文件只读读取（「代码」视图原文文本）：路径封死在工作区内，限文本扩展。
     * P1-3 安全校验与内联管线见 design-plugin-project-files.ts。 */
    openProjectFile: async ({ threadId }) => {
      const thread = services.store?.getThread(threadId);
      if (!thread?.projectId || !services.mainWindow)
        throw new Error(uiText(currentLocale(), "DesignHost.openProjectFirst"));
      const workspace = await resolveThreadWorkspace(thread);
      const result = await dialog.showOpenDialog(services.mainWindow, {
        title: uiText(currentLocale(), "DesignHost.openDesignPage"),
        defaultPath: workspace.workspacePath,
        properties: ["openFile"],
        filters: [
          {
            name: uiText(currentLocale(), "DesignHost.htmlPages"),
            extensions: ["html", "htm"],
          },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return {};
      const path = relative(
        workspace.workspacePath,
        result.filePaths[0],
      ).replaceAll("\\", "/");
      if (!/\.html?$/i.test(path))
        throw new Error(uiText(currentLocale(), "DesignHost.selectHtml"));
      // Reuse the preview reader's containment and symlink checks before listing.
      await readProjectFileForPreview({
        locale: currentLocale(),
        workspacePath: workspace.workspacePath,
        requestedPath: path,
      });
      const info = await stat(result.filePaths[0]);
      const files = selectedDesignProjectFiles.get(threadId) ?? [];
      selectedDesignProjectFiles.set(threadId, [
        ...files.filter((file) => file.path !== path),
        { path, bytes: info.size, updatedAt: info.mtime.toISOString() },
      ]);
      await pushDesignSnapshot(threadId, "workspace");
      return { path };
    },
    readProjectFile: async (input) => {
      if (!services.store)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store.getThread(input.threadId);
      if (!thread)
        throw new Error(
          uiText(currentLocale(), "DesignHost.activeTaskMissing"),
        );
      const workspace = await resolveThreadWorkspace(thread);
      const requestedPath = String(input.path ?? "").trim();
      const { content } = await readProjectFileForPreview({
        locale: currentLocale(),
        workspacePath: workspace.workspacePath,
        requestedPath,
      });
      // 页面间导航与相对资源的解析基址：srcdoc 无 base URL（相对引用会落
      // 到面板自身目录 → 404 白屏）。宿主开一个 lease，把目录级 URL 交给
      // 面板注入 <base>——页面 location.href/<a href> 导航到租约内兄弟
      // 文件即真实显示（OD 的 /raw/ base 同构）。lease 进程期保留。
      let baseUrl: string | undefined;
      if (/\.html?$/i.test(requestedPath)) {
        try {
          const { url } = await workspaceHtmlPreview.open(
            input.threadId,
            requestedPath,
          );
          baseUrl = url.replace(/[^/]+$/, "");
        } catch {
          baseUrl = undefined;
        }
      }
      return {
        name: requestedPath,
        content,
        ...(baseUrl ? { baseUrl } : {}),
      };
    },
    /** 项目 HTML 预览 lease：面板只换得 artemis-preview URL（URL-load，
     * 相对资源由协议处理器在文件目录内解析——OD 的 /raw/ 同构）。 */
    projectPreview: async (input) => {
      if (!services.store)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store.getThread(input.threadId);
      if (!thread)
        throw new Error(
          uiText(currentLocale(), "DesignHost.activeTaskMissing"),
        );
      return workspaceHtmlPreview.open(input.threadId, String(input.path));
    },
    exportDocument: async (input) => {
      // 账本退役：导出对象=工作区文件（panel-project:<path>）
      if (!services.store)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store.getThread(input.threadId);
      if (!thread?.projectId)
        throw new Error(uiText(currentLocale(), "DesignHost.projectOnly"));
      const raw = String(input.documentId ?? "");
      if (!raw.startsWith("panel-project:"))
        throw new Error(
          uiText(currentLocale(), "DesignHost.exportUnsupported"),
        );
      const rel = raw.slice("panel-project:".length);
      const workspace = await resolveThreadWorkspace(thread);
      const abs = resolve(workspace.workspacePath, rel);
      if (
        !abs.startsWith(resolve(workspace.workspacePath) + sep) ||
        !/\.html?$/i.test(abs)
      )
        throw new Error("Invalid project file path.");
      const bytes = await readFile(abs).catch(() => undefined);
      if (!bytes)
        throw new Error(uiText(currentLocale(), "DesignHost.fileUnreadable"));
      const revision = "";
      const displayName = rel.split("/").pop() || "document.html";
      const parent =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      const save = parent
        ? await dialog.showSaveDialog(parent, {
            defaultPath: displayName,
            filters: [{ name: "HTML", extensions: ["html"] }],
          })
        : { canceled: true, filePath: "" as string | undefined };
      if (save.canceled || !save.filePath) {
        return { path: "", revision, canceled: true };
      }
      await writeFile(save.filePath, bytes);
      services.store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/export`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "document-exported",
          documentId: raw,
          revision,
          destination: save.filePath,
        },
      });
      return { path: save.filePath, revision };
    },
    readDocument: async (input) => {
      // 账本退役：读取对象=工作区文件（panel-project:<path> 或裸路径）
      if (!services.store) return undefined;
      const thread = services.store.getThread(input.threadId);
      if (!thread?.projectId) return undefined;
      const raw = String(input.documentId ?? "");
      const rel = raw.startsWith("panel-project:")
        ? raw.slice("panel-project:".length)
        : raw;
      if (!rel || rel.includes("..") || !/\.html?$/i.test(rel))
        return undefined;
      const workspace = await resolveThreadWorkspace(thread);
      const abs = resolve(workspace.workspacePath, rel);
      if (!abs.startsWith(resolve(workspace.workspacePath) + sep))
        return undefined;
      const html = await readFile(abs, "utf8").catch(() => undefined);
      if (html === undefined) return undefined;
      return { html, name: rel.split("/").pop() ?? rel };
    },
    listDocuments: async (input) => {
      // 账本退役：清单=工作区扫描（与 deliverDesignSnapshot 同一来源）
      const thread = services.store?.getThread(input.threadId);
      const project = thread?.projectId
        ? services.store?.getProject(thread.projectId)
        : undefined;
      let projectFiles = selectedDesignProjectFiles.get(input.threadId) ?? [];
      if (thread?.projectId) {
        try {
          const workspace = await resolveThreadWorkspace(thread);
          const scanned = await scanProjectDesignFiles(workspace.workspacePath);
          const selected = new Set(projectFiles.map((f) => f.path));
          projectFiles = [
            ...projectFiles,
            ...scanned.filter((f) => !selected.has(f.path)),
          ];
        } catch (error) {
          console.error("[design-panel] project scan failed", error);
        }
      }
      return {
        documents: [],
        projectFiles,
        canOpenProject: Boolean(thread?.projectId),
        projectName:
          project?.name ?? uiText(currentLocale(), "DesignHost.designTask"),
      };
    },
    handoff: createDesignHandoffHandler(
      () => services.store,
      resolveThreadWorkspace,
      currentLocale,
    ),
    restoreDocument: async (input) => {
      // 账本退役：恢复=把薄快照内容写回工作区文件。写入走原工作区写入门禁
      // 之外的面板专用通道，但保留 Plan 模式拒绝（P1-7 语义不变）。
      if (!services.store)
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.hostUnavailable"),
        };
      const thread = services.store.getThread(input.threadId);
      if (!thread?.projectId || thread.archived) {
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.historyProjectOnly"),
        };
      }
      if (!isExecutionMode(thread.mode)) {
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.restorePlanDenied"),
        };
      }
      const raw = String(input.documentId ?? "");
      if (!raw.startsWith("panel-project:"))
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.noHistory"),
        };
      const rel = raw.slice("panel-project:".length);
      const workspace = await resolveThreadWorkspace(thread);
      const versions = await listDesignThinVersions(
        workspace.workspacePath,
        rel,
      );
      if (versions.length === 0) {
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.noRestorableVersion"),
        };
      }
      const authorize = async () => {
        const unavailable = await services.designPluginAvailabilityGate?.(
          input.threadId,
        );
        if (unavailable) throw new Error(unavailable);
        const current = services.store?.getThread(input.threadId);
        if (
          !current ||
          current.archived ||
          !isExecutionMode(current.mode) ||
          current.projectId !== thread.projectId ||
          current.typeBinding?.bindingRevision !==
            thread.typeBinding?.bindingRevision
        )
          throw new Error(uiText(currentLocale(), "DesignHost.taskChanged"));
      };
      // revision 缺省=最新一份；restore 的 file 参数由 revision 匹配
      const target = input.revision
        ? versions.findLast((v) => v.revision === input.revision)
        : versions.at(-1);
      if (!target)
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.restoreTargetMissing"),
        };
      const content = await restoreDesignThinVersion(
        workspace.workspacePath,
        rel,
        target.file,
        authorize,
      );
      if (content === undefined) {
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.restoreTargetMissing"),
        };
      }
      services.store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/restore`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "document-restored",
          documentId: raw,
          revision: target.revision,
        },
      });
      return { ok: true, documentHtml: content, name: target.file };
    },
    captureScreenshot: async (input) => {
      if (!services.store)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store.getThread(input.threadId);
      if (!thread?.projectId)
        throw new Error(uiText(currentLocale(), "DesignHost.projectOnly"));
      const raw = String(input.documentId ?? "");
      const rel = raw.startsWith("panel-project:")
        ? raw.slice("panel-project:".length)
        : raw;
      // P2-16：真实像素捕获——面板预览区域截图为 PNG。
      const image = await services.designPanelHost?.capturePanelArea(
        input.threadId,
        input.panelId,
        input.rect,
      );
      if (!image || image.isEmpty()) {
        throw new Error(uiText(currentLocale(), "DesignHost.panelNotVisible"));
      }
      const screenshotRoot = join(
        app.getPath("userData"),
        "design-screenshots",
        encodeURIComponent(rel || "viewport"),
      );
      await mkdir(screenshotRoot, { recursive: true });
      const destination = join(
        screenshotRoot,
        `${Date.now()}-${Math.round(image.getSize().width)}w.png`,
      );
      await writeFile(destination, image.toPNG());
      services.store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/screenshot`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "document-screenshot",
          documentId: raw,
          revision: "",
          destination,
        },
      });
      return { path: destination };
    },
    deleteDocument: async (input) => {
      // 账本退役：删除=删工作区文件（破坏性写入，Plan 拒绝语义不变）
      if (!services.store)
        throw new Error(uiText(currentLocale(), "DesignHost.hostUnavailable"));
      const thread = services.store.getThread(input.threadId);
      if (!thread?.projectId) {
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.projectOnly"),
        };
      }
      if (!isExecutionMode(thread.mode)) {
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.deletePlanDenied"),
        };
      }
      const raw = String(input.documentId ?? "");
      if (!raw.startsWith("panel-project:"))
        return {
          ok: false,
          error: uiText(currentLocale(), "DesignHost.deleteUnsupported"),
        };
      const rel = raw.slice("panel-project:".length);
      const workspace = await resolveThreadWorkspace(thread);
      const abs = await resolveDesignWorkspacePath(
        workspace.workspacePath,
        rel,
      );
      await recordDesignThinSnapshot(workspace.workspacePath, rel);
      const current = services.store.getThread(input.threadId);
      if (
        !current ||
        current.archived ||
        !isExecutionMode(current.mode) ||
        current.projectId !== thread.projectId
      )
        throw new Error(uiText(currentLocale(), "DesignHost.taskChanged"));
      await resolveDesignWorkspacePath(workspace.workspacePath, rel);
      await rm(abs, { force: true });
      services.store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/delete`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "document-deleted",
          documentId: raw,
        },
      });
      pushDesignSnapshotDebounced(input.threadId, input.panelId ?? "workspace");
      return { ok: true };
    },
    listVersions: async (input) => {
      // 账本退役：历史=工作区文件薄快照。绑定身份是 panel-project:<path>
      //（托管文档身份已不存在）。
      const raw = String(input.documentId ?? "");
      if (!raw.startsWith("panel-project:"))
        throw new Error(uiText(currentLocale(), "DesignHost.noHistory"));
      const rel = raw.slice("panel-project:".length);
      const thread = services.store?.getThread(input.threadId);
      if (!thread?.projectId)
        throw new Error(
          uiText(currentLocale(), "DesignHost.historyProjectOnly"),
        );
      const workspace = await resolveThreadWorkspace(thread);
      const versions = await listDesignThinVersions(
        workspace.workspacePath,
        rel,
      );
      return {
        output: JSON.stringify({
          documentId: raw,
          versions: versions.map((v) => ({
            revision: v.revision,
            sequence: v.sequence,
            file: v.file,
            occurredAt: v.occurredAt,
            current: v.current,
          })),
        }),
      };
    },
  });
  // Candidate prompts flow main -> renderer; the panel never gets a channel.
  services.designPanelHost?.onCandidatePrompt((candidate) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC.designPanelCandidate, {
        kind: candidate.kind,
        threadId: candidate.threadId,
        panelId: candidate.panelId,
        text: candidate.text,
        source: candidate.source,
        occurredAt: candidate.occurredAt,
        ...(candidate.autoSend === false ? { autoSend: false } : {}),
        ...(candidate.images ? { images: candidate.images } : {}),
        ...(candidate.annotations
          ? { annotations: candidate.annotations }
          : {}),
        ...(candidate.document ? { document: candidate.document } : {}),
      });
    }
  });
  // Composer binding (OD activeProjectFileName): the panel's active document
  // tab locks the composer onto that page; null unbinds (files grid).
  services.designPanelHost?.onActiveDocument((binding) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(IPC.designPanelBinding, binding);
    }
  });

  // 工作区"+"菜单：透明子窗口承载应用自绘 HTML（独立原生层，浮于设计面板
  // 之上）。选择回包发给开菜单的窗口；无选择关闭只回按钮复位信号。
  setWorkspaceTabMenuHandlers({
    onSelect: (kind) => {
      const window = workspaceTabMenuParent();
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC.workspaceTabMenuSelect, kind);
      }
    },
    onDismiss: () => {
      const window = workspaceTabMenuParent();
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC.workspaceTabMenuClosed);
      }
    },
  });
  ipcMain.handle(IPC.workspaceTabMenuShow, (event, input) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    return showWorkspaceTabMenu(window, input);
  });
  ipcMain.handle(IPC.workspaceTabMenuClose, () => {
    closeWorkspaceTabMenu();
  });

  ipcMain.handle(
    IPC.workspaceHtmlOpen,
    async (event, threadId: string, href: string) => {
      assertWorkspacePreviewSender(event);
      if (typeof threadId !== "string" || typeof href !== "string")
        throw new Error("Invalid HTML request.");
      return workspaceHtmlPreview.open(threadId, href);
    },
  );
  ipcMain.handle(
    IPC.workspaceHtmlRelease,
    (event, threadId: string, url: string) => {
      assertWorkspacePreviewSender(event);
      workspaceHtmlPreview.release(threadId, url);
    },
  );
}
