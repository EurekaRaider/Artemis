import { join } from "node:path";
import { app } from "electron";
import {
  reviewMutationInputSchema,
  reviewQuerySchema,
} from "@artemis/protocol";
import { getReviewDiff, mutateReviewDiff } from "../workspace/git-review.js";
import { conversationSupportsProjectFeatures } from "../conversation/temporary-conversation.js";
import {
  IPC,
  type AddReviewCommentInput,
  type ReviewDiff,
  type ReviewComment,
  type ReviewMutationInput,
  type ReviewMutationResult,
  type ReviewQuery,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "turnChangeSetService"
  | "resolveThreadWorkspace"
  | "ipcMain"
  | "activeTurns"
>;

export function registerReviewIpc(services: Dependencies): void {
  const { resolveThreadWorkspace, ipcMain, activeTurns } = services;

  ipcMain.handle(
    IPC.reviewDiff,
    async (_event, untrustedQuery: ReviewQuery): Promise<ReviewDiff> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const query = reviewQuerySchema.parse(untrustedQuery);
      const thread = services.store.getThread(query.threadId);
      if (!thread) {
        return {
          available: false,
          scope: query.scope,
          text: "",
          files: [],
          message: "Project not found.",
        };
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        return {
          available: false,
          scope: query.scope,
          text: "",
          files: [],
          message: "Temporary conversations do not have a project review.",
        };
      }
      if (query.scope === "turn") {
        return (
          services.turnChangeSetService?.review(thread.id, query.turnId!) ?? {
            available: false,
            scope: "turn",
            text: "",
            files: [],
            message: "Turn review is unavailable.",
          }
        );
      }
      try {
        const context = await resolveThreadWorkspace(thread);
        return await getReviewDiff({
          workspace: context.workspacePath,
          scope: query.scope,
          ...(query.baseRef ? { baseRef: query.baseRef } : {}),
          ...(query.scope === "last-turn"
            ? { paths: services.store.getLastTurnChangedFiles(thread.id) }
            : {}),
        });
      } catch (error) {
        return {
          available: false,
          scope: query.scope,
          text: "",
          files: [],
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.reviewMutate,
    async (
      _event,
      untrustedInput: ReviewMutationInput,
    ): Promise<ReviewMutationResult> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const input = reviewMutationInputSchema.parse(untrustedInput);
      const thread = services.store.getThread(input.threadId);
      if (!thread) {
        throw new Error("Project not found.");
      }
      if (!conversationSupportsProjectFeatures(thread)) {
        throw new Error(
          "Temporary conversations do not have a project review.",
        );
      }
      if (input.scope === "turn") {
        throw new Error("Turn review is immutable and read-only.");
      }
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(thread.id)
      ) {
        throw new Error("Review actions are disabled while a turn is active.");
      }
      const context = await resolveThreadWorkspace(thread);
      return mutateReviewDiff({
        workspace: context.workspacePath,
        scope: input.scope,
        action: input.action,
        target: input.target,
        recoveryRoot: join(app.getPath("userData"), "review-recovery"),
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
        ...(input.scope === "last-turn"
          ? { paths: services.store.getLastTurnChangedFiles(thread.id) }
          : {}),
      });
    },
  );

  ipcMain.handle(
    IPC.reviewCommentList,
    (_event, threadId: string): ReviewComment[] => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      if (
        typeof threadId !== "string" ||
        !threadId ||
        threadId.length > 100 ||
        !services.store.getThread(threadId)
      ) {
        throw new Error("Review task was not found.");
      }
      return services.store.listReviewComments(threadId);
    },
  );

  ipcMain.handle(
    IPC.reviewCommentAdd,
    async (
      _event,
      untrustedInput: AddReviewCommentInput,
    ): Promise<ReviewComment> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const query = reviewQuerySchema.parse(untrustedInput);
      const lineId =
        typeof untrustedInput?.lineId === "string"
          ? untrustedInput.lineId.trim()
          : "";
      const body =
        typeof untrustedInput?.body === "string"
          ? untrustedInput.body.trim()
          : "";
      if (!lineId || lineId.length > 128) {
        throw new Error("Review line anchor is invalid.");
      }
      if (!body || Buffer.byteLength(body, "utf8") > 16 * 1024) {
        throw new Error(
          "Review comment must contain between 1 byte and 16 KiB.",
        );
      }
      const thread = services.store.getThread(query.threadId);
      if (!thread) {
        throw new Error("Review task was not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      const diff = await getReviewDiff({
        workspace: context.workspacePath,
        scope: query.scope,
        ...(query.baseRef ? { baseRef: query.baseRef } : {}),
        ...(query.scope === "last-turn"
          ? { paths: services.store.getLastTurnChangedFiles(thread.id) }
          : {}),
      });
      for (const file of diff.files) {
        for (const hunk of file.hunks) {
          const line = hunk.lines.find((candidate) => candidate.id === lineId);
          if (line) {
            return services.store.addReviewComment(
              thread.id,
              {
                scope: query.scope,
                lineId,
                path: file.path,
                kind: line.kind,
                text: line.text,
                ...(line.oldLine === undefined
                  ? {}
                  : { oldLine: line.oldLine }),
                ...(line.newLine === undefined
                  ? {}
                  : { newLine: line.newLine }),
              },
              body,
            );
          }
        }
      }
      throw new Error(
        "Review line changed before the comment was saved. Refresh and retry.",
      );
    },
  );

  ipcMain.handle(
    IPC.reviewCommentDelete,
    (_event, threadId: string, commentId: string): void => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      if (
        typeof threadId !== "string" ||
        typeof commentId !== "string" ||
        !threadId ||
        !commentId ||
        threadId.length > 100 ||
        commentId.length > 100
      ) {
        throw new Error("Review comment identity is invalid.");
      }
      services.store.deleteReviewComment(threadId, commentId);
    },
  );
}
