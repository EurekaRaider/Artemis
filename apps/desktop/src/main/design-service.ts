import { designImageBytes } from "./design-image.js";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dialog, nativeImage } from "electron";
import type {
  DesignPanelAction,
  DesignPanelState,
  DesignToolOperation,
  DesignRef,
} from "@artemis/protocol";
import { DesignRepository, requireDesignExecute } from "./design-repository.js";
import { DesignPreviewHost } from "./design-preview-host.js";
import { patchDesignPage, designSourceMap } from "./design-document-source.js";
import { exportStaticDesign } from "./design-export.js";
import type { DesignHostContext } from "./design-store.js";

export class DesignService {
  private readonly drafts = new Map<
    string,
    {
      context: DesignHostContext;
      input: Extract<DesignPanelAction, { action: "patch" }>;
    }
  >();
  private leaving: Promise<boolean> | undefined;
  hasDrafts(threadId?: string) {
    return [...this.drafts.values()].some(
      (draft) => !threadId || draft.context.threadId === threadId,
    );
  }
  async draft(
    threadId: string,
    key: string,
    input: Extract<DesignPanelAction, { action: "patch" }> | null,
  ) {
    if (key.length > 512) throw new Error("Invalid draft key.");
    const id = `${threadId}:${key}`;
    if (!input) {
      this.drafts.delete(id);
      return;
    }
    if (
      input.action !== "patch" ||
      input.patches.length > 128 ||
      Buffer.byteLength(JSON.stringify(input)) > 32 * 1024 * 1024
    )
      throw new Error("Draft exceeds the editing limits.");
    const context = await this.context(threadId);
    this.repository.read(context, input.documentId, input.baseRevision);
    this.drafts.set(id, { context, input });
  }
  confirmLeave(threadId?: string): Promise<boolean> {
    if (this.leaving) return this.leaving;
    const entries = [...this.drafts].filter(
      ([, draft]) => !threadId || draft.context.threadId === threadId,
    );
    if (!entries.length) return Promise.resolve(true);
    const restorePreview = this.preview.suspendVisibility();
    this.leaving = (async () => {
      const choice = await dialog.showMessageBox({
        type: "question",
        title: "未保存的设计编辑",
        message: "离开前如何处理设计草稿？",
        buttons: ["保存并离开", "丢弃并离开", "取消"],
        defaultId: 2,
        cancelId: 2,
      });
      if (choice.response === 2) return false;
      try {
        for (const [key, draft] of entries) {
          if (choice.response === 0) {
            const current = await this.context(draft.context.threadId);
            if (
              current.workspaceBinding !== draft.context.workspaceBinding ||
              current.projectId !== draft.context.projectId
            )
              throw new Error("工作区已改变，请回到原工作区保存草稿。");
            await this.action(current.threadId, draft.input);
          }
          this.drafts.delete(key);
        }
        return true;
      } catch (error) {
        await dialog.showMessageBox({
          type: "error",
          message: "草稿仍已保留",
          detail: String(error),
        });
        return false;
      }
    })().finally(() => {
      restorePreview();
      this.leaving = undefined;
    });
    return this.leaving;
  }

  constructor(
    readonly repository: DesignRepository,
    readonly preview: DesignPreviewHost,
    private readonly context: (threadId: string) => Promise<DesignHostContext>,
    private readonly pump: (threadId: string) => Promise<void>,
  ) {}

  async state(threadId: string): Promise<DesignPanelState> {
    const context = await this.context(threadId);
    const preview = this.preview.state(threadId);
    if (context.mode !== "execute" && preview?.status === "running")
      this.preview.stop();
    return {
      workflow: this.repository.workflow(threadId),
      documents: this.repository.list(context),
      requests: this.repository.requests(threadId),
      ...(this.preview.state(threadId)
        ? { preview: this.preview.state(threadId)! }
        : {}),
    };
  }

  async tool(
    threadId: string,
    operation: DesignToolOperation,
    workflow: "code" | "design",
    ref?: DesignRef,
  ): Promise<unknown> {
    const context = await this.context(threadId);
    if (operation.action === "list") return this.repository.list(context);
    if (operation.action === "read") {
      if (
        ref &&
        (ref.documentId !== operation.documentId ||
          ref.revisionId !== operation.revisionId)
      )
        throw new Error(
          "Implementation must read the selected immutable design revision.",
        );
      const revision = this.repository.read(
        context,
        operation.documentId,
        operation.revisionId,
      );
      if (ref)
        revision.content.variants = revision.content.variants
          .filter((variant) => variant.id === ref.variantId)
          .map((variant) => ({
            ...variant,
            pages: variant.pages.filter((page) =>
              ref.pageIds.includes(page.id),
            ),
          }));
      if (operation.visual && (!operation.variantId || !operation.pageId))
        throw new Error(
          "Visual evidence requires an exact variantId and pageId.",
        );
      let value: unknown = revision;
      if (operation.variantId || operation.pageId) {
        const variant = revision.content.variants.find(
          (item) => item.id === operation.variantId,
        );
        const page = variant?.pages.find(
          (item) => item.id === operation.pageId,
        );
        if (!page)
          throw new Error(
            "Select an existing variantId and pageId from this revision.",
          );
        if (operation.visual) {
          const evidence = this.repository.inspection(
            context,
            revision.documentId,
            revision.revisionId,
            variant!.id,
            page.id,
          );
          if (!evidence)
            throw new Error("This page has no saved inspection evidence.");
          return evidence;
        }
        value = {
          documentId: revision.documentId,
          revisionId: revision.revisionId,
          digest: revision.digest,
          variantId: variant!.id,
          page,
          interactionNotes: revision.content.interactionNotes,
        };
      }
      const text = JSON.stringify(value);
      const offset = operation.offset ?? 0;
      const limit = operation.limit ?? 12000;
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > text.length ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 48000
      )
        throw new Error("Invalid bounded source range.");
      const end = Math.min(text.length, offset + limit);
      return {
        documentId: revision.documentId,
        revisionId: revision.revisionId,
        digest: revision.digest,
        totalCharacters: text.length,
        offset,
        nextOffset: end < text.length ? end : null,
        text: text.slice(offset, end),
      };
    }
    requireDesignExecute(context);
    if (workflow !== "design")
      throw new Error("Design mutation requires the active Design workflow.");
    if (operation.action === "save") {
      const revision = this.repository.save(context, operation);
      const { content: _content, ...result } = revision;
      return result;
    }
    if (operation.action === "inspect") {
      const revision = this.repository.read(
        context,
        operation.documentId,
        operation.revisionId,
      );
      const result = await this.preview.inspect(
        threadId,
        revision,
        operation.variantId,
        operation.pageId,
        operation.actions,
      );
      this.repository.recordInspection(
        await this.context(threadId),
        operation.documentId,
        result,
      );
      return result;
    }
    throw new Error("Unknown design operation.");
  }

  async action(
    threadId: string,
    input: DesignPanelAction,
  ): Promise<DesignPanelState> {
    const context = await this.context(threadId);
    let revision;
    switch (input.action) {
      case "selection-image": {
        requireDesignExecute(context);
        const preview = this.preview.state(threadId);
        const data = await this.preview.selectionImage(
          threadId,
          input.instanceId,
        );
        return {
          ...(await this.state(threadId)),
          selectionImage: {
            name: `design-${preview!.revisionId}-${preview!.pageId}.png`,
            mimeType: "image/png",
            data,
          },
        };
      }
      case "read":
        revision = this.repository.read(
          context,
          input.documentId,
          input.revisionId,
        );
        break;
      case "save":
        revision = this.repository.save(context, input);
        break;
      case "patch":
      case "draft-preview": {
        requireDesignExecute(context);
        revision = this.repository.read(
          context,
          input.documentId,
          input.baseRevision,
        );
        const variant = revision.content.variants.find(
          (item) => item.id === input.variantId,
        );
        const index =
          variant?.pages.findIndex((item) => item.id === input.pageId) ?? -1;
        if (
          !variant ||
          index < 0 ||
          !Array.isArray(input.patches) ||
          input.patches.length > 128
        )
          throw new Error("Invalid design edit.");
        for (const patch of input.patches)
          if (patch.type === "image") {
            const image = nativeImage.createFromBuffer(
              designImageBytes(patch.dataUrl),
            );
            const size = image.getSize();
            if (image.isEmpty() || size.width * size.height > 16_000_000)
              throw new Error(
                "Image could not be decoded within the pixel limit.",
              );
            const png = image.toPNG();
            if (png.length > 4 * 1024 * 1024)
              throw new Error("Decoded image exceeds the resource limit.");
            patch.dataUrl = `data:image/png;base64,${png.toString("base64")}`;
          }
        let page = variant.pages[index]!;
        page = patchDesignPage(page, input.patches);
        variant.pages[index] = page;
        if (input.action === "draft-preview") {
          await this.preview.show(
            threadId,
            revision,
            input.variantId,
            input.pageId,
            true,
          );
          revision = undefined;
        } else
          revision = this.repository.save(context, {
            operationId: input.operationId,
            documentId: input.documentId,
            baseRevision: input.baseRevision,
            content: revision.content,
          });
        break;
      }
      case "preview":
      case "inspect": {
        requireDesignExecute(context);
        revision = this.repository.read(
          context,
          input.documentId,
          input.revisionId,
        );
        if (input.action === "preview")
          await this.preview.show(
            threadId,
            revision,
            input.variantId,
            input.pageId,
          );
        else {
          const result = await this.preview.inspect(
            threadId,
            revision,
            input.variantId,
            input.pageId,
          );
          this.repository.recordInspection(
            await this.context(threadId),
            input.documentId,
            result,
          );
        }
        break;
      }
      case "stop":
        if (this.preview.state(threadId)) this.preview.stop();
        break;
      case "export": {
        requireDesignExecute(context);
        if (this.preview.state(threadId)?.draft)
          throw new Error("Save the draft before exporting.");
        const html = exportStaticDesign(
          await this.preview.staticSnapshot(threadId, input.instanceId),
        );
        const destination = await dialog.showSaveDialog({
          title: "Export static design",
          defaultPath: "design.html",
          filters: [{ name: "Static HTML", extensions: ["html"] }],
        });
        if (!destination.canceled && destination.filePath) {
          const current = await this.context(threadId);
          requireDesignExecute(current);
          if (current.workspaceBinding !== context.workspaceBinding)
            throw new Error("Workspace changed before export.");
          await writeFile(destination.filePath, html, {
            encoding: "utf8",
            mode: 0o600,
          });
        }
        break;
      }
      case "workflow":
        if (input.workflow !== "code" && input.workflow !== "design")
          throw new Error("Invalid workflow.");
        this.repository.setWorkflow(threadId, input.workflow);
        if (input.workflow === "code" && this.preview.state(threadId))
          this.preview.stop();
        break;
      case "implement": {
        requireDesignExecute(context);
        if (this.hasDrafts(threadId))
          throw new Error(
            "Save or discard design drafts before implementation.",
          );
        this.repository.enqueue(context, {
          requestId: input.requestId || randomUUID(),
          workflow: "code",
          designRef: input.ref,
          text: `Implement the selected design in this task's workspace. Read this exact immutable selection with design_document before editing code: ${JSON.stringify(input.ref)}. Preserve the project architecture and verify the implemented behavior.`,
        });
        if (this.preview.state(threadId)) this.preview.stop();
        await this.pump(threadId);
        break;
      }
      case "cancel":
        this.repository.cancel(threadId, input.requestId);
        await this.pump(threadId);
        break;
      case "retry":
        this.repository.retry(context, input.requestId);
        await this.pump(threadId);
        break;
      case "reorder":
        this.repository.reorder(threadId, input.requestIds);
        break;
      case "edit-request":
        this.repository.edit(context, input.requestId, input.text);
        break;
      default:
        throw new Error("Unknown design action.");
    }
    return {
      ...(await this.state(threadId)),
      ...(revision
        ? {
            revision,
            history: this.repository.history(context, revision.documentId),
            thumbnails: this.repository
              .inspections(context, revision.documentId, revision.revisionId)
              .map((item) => ({
                variantId: item.variantId,
                pageId: item.pageId,
                passed: item.passed,
                dataUrl: nativeImage
                  .createFromDataURL(item.screenshot)
                  .resize({ width: 240 })
                  .toDataURL(),
              })),
            sources: Object.fromEntries(
              revision.content.variants.map((variant) => [
                variant.id,
                Object.fromEntries(
                  variant.pages.map((page) => [page.id, designSourceMap(page)]),
                ),
              ]),
            ),
          }
        : {}),
    };
  }
}
