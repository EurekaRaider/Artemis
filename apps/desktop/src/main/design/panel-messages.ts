import { uiText } from "../../shared/i18n/ui-text.js";

import { type AppLocale } from "@artemis/protocol";
import { designPanelLocaleMessage } from "../../shared/i18n/design-panel-copy.js";

import type {
  LivePanel,
  CandidatePromptEvent,
  PanelRequestHandlers,
} from "./panel-contracts.js";
import {
  sanitizeAnnotations,
  sanitizeDocumentPayload,
  sanitizeCandidateImages,
} from "./panel-payloads.js";
interface PanelMessageServices {
  readonly candidateSink: ((event: CandidatePromptEvent) => void) | undefined;
  key: (threadId: string, panelId: string) => string;
  readonly panels: Map<string, LivePanel>;
  readonly locale: AppLocale;
  readonly snapshotSink:
    ((event: { threadId: string; panelId: string }) => void) | undefined;
  readonly requestHandlers: PanelRequestHandlers | undefined;
  readonly bindingSink:
    | ((event: {
        threadId: string;
        panelId: string;
        documentId: string | null;
        name?: string;
        html?: string;
      }) => void)
    | undefined;
  capturePanelArea: (
    threadId: string,
    panelId: string | undefined,
    rect?: { x: number; y: number; width: number; height: number },
  ) => Promise<Electron.NativeImage | undefined>;
}
export function createPanelMessageHandler(
  services: PanelMessageServices,
  threadId: string,
  panelId: string,
  hostPort: Electron.MessagePortMain,
) {
  return (event: { data: unknown }) => {
    const data = event.data as
      | {
          type?: string;
          text?: string;
          documentId?: string;
          requestId?: number;
          revision?: string;
          name?: string;
          html?: string;
          path?: string;
          url?: string;
          thumb?: boolean;
          autoSend?: boolean;
          images?: unknown;
          annotations?: unknown;
          document?: unknown;
          rect?: unknown;
        }
      | undefined;
    if (data?.type === "candidate-prompt" && typeof data.text === "string") {
      const annotations = sanitizeAnnotations(data.annotations);
      const document = sanitizeDocumentPayload(data.document);
      const images = sanitizeCandidateImages(data.images);
      services.candidateSink?.({
        kind: "candidate-prompt",
        threadId,
        panelId,
        text: data.text,
        source: "panel",
        occurredAt: new Date().toISOString(),
        ...(data.autoSend === false ? { autoSend: false } : {}),
        ...(images ? { images } : {}),
        ...(annotations ? { annotations } : {}),
        ...(document ? { document } : {}),
      });
      return;
    }
    // S4 host-owned actions: the panel only requests; the handlers run in
    // the main process (export writes the file, list_versions dispatches
    // through the trusted plugin runtime).
    if (data?.type === "snapshot-ack") {
      const live = services.panels.get(services.key(threadId, panelId));
      if (live) live.snapshotAcked = true;
      return;
    }
    // 面板就绪后主动拉完整快照：首开时 host 的初始 push 可能早于 port
    // 握手完成而丢失（面板白屏无卡片），拉模式兜底推模式。
    if (data?.type === "snapshot-request") {
      hostPort.postMessage(designPanelLocaleMessage(services.locale));
      console.log(
        `[design-panel] snapshot-request from ${threadId}/${panelId}`,
      );
      services.snapshotSink?.({ threadId, panelId });
      return;
    }
    if (data?.type === "open-project-file-request") {
      void (async () => {
        try {
          if (!services.requestHandlers?.openProjectFile)
            throw new Error(
              uiText(services.locale, "DesignHost.openUnavailable"),
            );
          const result = await services.requestHandlers.openProjectFile({
            threadId,
          });
          hostPort.postMessage({
            type: "open-project-file-result",
            ...result,
          });
        } catch (error) {
          hostPort.postMessage({
            type: "open-project-file-result",
            error: String(error),
          });
        }
      })();
      return;
    }
    if (data?.type === "read-project-file-request" && data.path) {
      void services.requestHandlers
        ?.readProjectFile({ threadId, path: String(data.path) })
        .then((result) => {
          hostPort.postMessage({
            type: "read-project-file-result",
            requestId: data.requestId,
            ...result,
          });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "read-project-file-error",
            requestId: data.requestId,
            path: String(data.path),
            error: String(error),
          });
        });
      return;
    }
    // 项目 HTML 预览（URL-load）：面板只拿到 artemis-preview URL；资源
    // 解析边界（文件所在目录内）由 WorkspaceHtmlPreview 的 lease 保证。
    if (data?.type === "project-preview-request" && data.path) {
      const thumb = data.thumb === true;
      void services.requestHandlers
        ?.projectPreview({
          threadId,
          path: String(data.path),
          ...(thumb ? { thumb: true } : {}),
        })
        .then((result) => {
          hostPort.postMessage({
            type: "project-preview-result",
            path: String(data.path),
            ...(thumb ? { thumb: true } : {}),
            ...result,
          });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "project-preview-error",
            path: String(data.path),
            ...(thumb ? { thumb: true } : {}),
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "export-request" && data.documentId) {
      void services.requestHandlers
        ?.exportDocument({
          threadId,
          documentId: data.documentId,
          ...(data.revision ? { revision: data.revision } : {}),
        })
        .then((result) => {
          hostPort.postMessage({ type: "export-result", ...result });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "export-error",
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "read-document-request" && data.documentId) {
      void services.requestHandlers
        ?.readDocument({ threadId, documentId: data.documentId })
        .then((document) => {
          hostPort.postMessage({
            type: "document-html",
            documentId: data.documentId,
            requestId: data.requestId,
            html: document?.html ?? "",
            ...(!document ? { error: "Document not found." } : {}),
            name: document?.name ?? "",
          });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "document-html",
            documentId: data.documentId,
            requestId: data.requestId,
            html: "",
            name: "",
            error: String(error),
          });
        });
      return;
    }
    // Composer binding (OD activeProjectFileName): the panel reports which
    // document tab is active (null = files grid unbinds). Forwarded to the
    // renderer, which shows the "editing" chip and attaches the page on
    // send. html is sanitized like the candidate document payload.
    if (data?.type === "active-document") {
      const name =
        typeof data.name === "string" ? data.name.slice(0, 256) : null;
      const html =
        typeof data.html === "string" && data.html.length <= 512 * 1024
          ? data.html
          : "";
      services.bindingSink?.({
        threadId,
        panelId,
        documentId:
          typeof data.documentId === "string"
            ? data.documentId.slice(0, 128)
            : null,
        ...(name ? { name } : {}),
        ...(html && name ? { html } : {}),
      });
      return;
    }
    // Page-card thumbnail fetch: same store read as read-document but the
    // reply does NOT drive the stage render — the panel mounts it into the
    // card grid (OD HtmlCardThumbnail equivalent).
    if (data?.type === "thumb-request" && data.documentId) {
      void services.requestHandlers
        ?.readDocument({ threadId, documentId: data.documentId })
        .then((document) => {
          hostPort.postMessage({
            type: "thumb",
            documentId: data.documentId,
            name: document?.name ?? "",
            html: (document?.html ?? "").slice(0, 512 * 1024),
          });
        })
        .catch(() => {
          hostPort.postMessage({
            type: "thumb",
            documentId: data.documentId,
            name: "",
            html: "",
          });
        });
      return;
    }
    if (data?.type === "list-versions-request" && data.documentId) {
      void services.requestHandlers
        ?.listVersions({ threadId, documentId: data.documentId })
        .then((versions) => {
          hostPort.postMessage({ type: "versions", versions });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "versions-error",
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "restore-request" && data.documentId) {
      void services.requestHandlers
        ?.restoreDocument({
          threadId,
          documentId: data.documentId,
          ...(data.revision ? { revision: data.revision } : {}),
        })
        .then((result) => {
          hostPort.postMessage({ type: "restore-result", ...result });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "restore-result",
            ok: false,
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "list-documents-request") {
      void services.requestHandlers
        ?.listDocuments({ threadId })
        .then((snapshot) => {
          hostPort.postMessage({ type: "snapshot", snapshot });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "snapshot-error",
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "handoff-request" && data.documentId) {
      void services.requestHandlers
        ?.handoff({ threadId, documentId: data.documentId })
        .then((result) => {
          hostPort.postMessage({ type: "handoff-result", ...result });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "handoff-result",
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "screenshot-request" && data.documentId) {
      // P2-16：带上发起面板与预览区域，宿主做真实像素捕获。
      const rawRect = data.rect as
        | { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
        | undefined;
      const rect =
        rawRect &&
        Number.isFinite(rawRect.x) &&
        Number.isFinite(rawRect.y) &&
        Number.isFinite(rawRect.width) &&
        Number.isFinite(rawRect.height) &&
        (rawRect.width as number) > 0 &&
        (rawRect.height as number) > 0
          ? {
              x: rawRect.x as number,
              y: rawRect.y as number,
              width: rawRect.width as number,
              height: rawRect.height as number,
            }
          : undefined;
      void services.requestHandlers
        ?.captureScreenshot({
          threadId,
          documentId: data.documentId,
          panelId,
          ...(rect ? { rect } : {}),
        })
        .then((result) => {
          hostPort.postMessage({ type: "screenshot-result", ...result });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "screenshot-result",
            error: String(error),
          });
        });
      return;
    }
    // 标记截图：面板视图的真实像素捕获（合成输出含沙箱帧内容与标记层），
    // PNG dataURL 回面板随候选走。失败回空——面板退回纯结构化标记。
    if (data?.type === "mark-shot-request") {
      const rawRect = data.rect as
        | { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
        | undefined;
      const rect =
        rawRect &&
        Number.isFinite(rawRect.x) &&
        Number.isFinite(rawRect.y) &&
        Number.isFinite(rawRect.width) &&
        Number.isFinite(rawRect.height) &&
        (rawRect.width as number) > 0 &&
        (rawRect.height as number) > 0
          ? {
              x: rawRect.x as number,
              y: rawRect.y as number,
              width: rawRect.width as number,
              height: rawRect.height as number,
            }
          : undefined;
      void (async () => {
        const image = await services.capturePanelArea(threadId, panelId, rect);
        if (!image || image.isEmpty()) {
          hostPort.postMessage({ type: "mark-shot-result" });
          return;
        }
        const sized =
          image.getSize().width > 1400 ? image.resize({ width: 1400 }) : image;
        hostPort.postMessage({
          type: "mark-shot-result",
          dataUrl: `data:image/png;base64,${sized.toPNG().toString("base64")}`,
        });
      })().catch(() => {
        hostPort.postMessage({ type: "mark-shot-result" });
      });
      return;
    }
    if (
      data?.type === "export-project-request" &&
      typeof data.path === "string"
    ) {
      void services.requestHandlers
        ?.exportProjectFile({ threadId, path: data.path })
        .then((result) => {
          hostPort.postMessage({
            type: "export-project-result",
            ...(result.path ? { path: result.path } : {}),
            ...(result.canceled ? { canceled: true } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "export-project-result",
            error: String(error),
          });
        });
      return;
    }
    if (data?.type === "pick-image-folder-request") {
      void (async () => {
        try {
          if (!services.requestHandlers?.pickImageFolder)
            throw new Error(
              uiText(services.locale, "DesignHost.hostUnavailable"),
            );
          const result = await services.requestHandlers.pickImageFolder({
            threadId,
          });
          hostPort.postMessage({
            type: "pick-image-folder-result",
            ...(result.imageDir ? { imageDir: result.imageDir } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
        } catch (error) {
          hostPort.postMessage({
            type: "pick-image-folder-result",
            error: String(error),
          });
        }
      })();
      return;
    }
    if (data?.type === "read-image-request" && typeof data.path === "string") {
      void services.requestHandlers
        ?.readImage({ path: data.path, threadId })
        .then((result) => {
          hostPort.postMessage({
            type: "read-image-result",
            path: data.path,
            ...(result?.dataUrl ? { dataUrl: result.dataUrl } : {}),
          });
        })
        .catch(() => {
          hostPort.postMessage({
            type: "read-image-result",
            path: data.path,
          });
        });
      return;
    }
    if (data?.type === "delete-document-request" && data.documentId) {
      void services.requestHandlers
        ?.deleteDocument({
          threadId,
          documentId: data.documentId,
          panelId,
        })
        .then((result) => {
          hostPort.postMessage({ type: "delete-document-result", ...result });
        })
        .catch((error: unknown) => {
          hostPort.postMessage({
            type: "delete-document-result",
            ok: false,
            error: String(error),
          });
        });
      return;
    }
  };
}
