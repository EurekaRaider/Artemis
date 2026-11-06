import { inspectGitBranches } from "../../../../src/main/workspace/git-branches.js";
import {
  IPC,
  type ProjectPullRequestCheck,
} from "../../../../src/shared/api.js";
import { store, workspaceForGitRequest } from "../../../../src/main/main.js";
import { smokeMode } from "../environment.js";

export function decorateWorkspaceIpc(
  channel: string,
  next: Parameters<import("electron").IpcMain["handle"]>[1],
) {
  const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
  if (
    channel === IPC.workspaceFileWrite &&
    smokeMode &&
    view === "markdown-editor-save-error"
  )
    return async (
      _event: Electron.IpcMainInvokeEvent,
      threadId: string,
      path: string,
      content: string,
    ) => {
      if (!store) {
        throw new Error("Application store is not ready.");
      }
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "markdown-editor-save-error"
      ) {
        throw new Error("Simulated workspace file save failure.");
      }
      return next(_event, threadId, path, content);
    };
  if (
    channel === IPC.projectPullRequest &&
    (view.startsWith("environment") ||
      view.startsWith("icon-sizing-environment"))
  )
    return async (
      _event: Electron.IpcMainInvokeEvent,
      projectId: string,
      threadId?: string,
    ) => {
      const context = await workspaceForGitRequest(projectId, threadId);
      if (
        smokeMode &&
        (process.env.ARTEMIS_SMOKE_VIEW?.startsWith("environment-pr-checks") ||
          process.env.ARTEMIS_SMOKE_VIEW?.startsWith("icon-sizing-environment"))
      ) {
        const gitInfo = await inspectGitBranches(context.workspacePath);
        const checks: ProjectPullRequestCheck[] =
          process.env.ARTEMIS_SMOKE_VIEW === "environment-pr-checks-empty"
            ? []
            : [
                {
                  name: "Test, typecheck, build and format",
                  status: "passed",
                  workflowName: "CI",
                  detailsUrl: "https://github.com/EurekaRaider/Artemis/actions",
                },
                {
                  name: "Desktop skin and package boundary",
                  status: "pending",
                  workflowName: "CI",
                },
                {
                  name: "Windows native sandbox integration",
                  status: "failed",
                  workflowName: "CI",
                  detailsUrl: "https://github.com/EurekaRaider/Artemis/actions",
                },
                {
                  name: "Gallery macOS",
                  status: "skipped",
                  workflowName: "CI",
                },
                {
                  name: "Gallery Windows",
                  status: "cancelled",
                  workflowName: "CI",
                },
              ];
        return {
          status: "found",
          pullRequest: {
            number: 80,
            title: "Stop stalled model streams",
            url: "https://github.com/EurekaRaider/Artemis/pull/80",
            state:
              process.env.ARTEMIS_SMOKE_REVIEW06_PR === "merged"
                ? "MERGED"
                : process.env.ARTEMIS_SMOKE_REVIEW06_PR === "closed"
                  ? "CLOSED"
                  : "OPEN",
            isDraft: process.env.ARTEMIS_SMOKE_REVIEW06_PR === "draft",
            headRefName: gitInfo.currentBranch ?? "main",
            headRefOid: gitInfo.headOid ?? "0".repeat(40),
            checks,
          },
        };
      }
      const smokeView = process.env.ARTEMIS_SMOKE_VIEW;
      if (
        smokeView?.startsWith("environment") ||
        smokeView?.startsWith("icon-sizing-environment")
      ) {
        return { status: "not-found" };
      }
      return next(_event, projectId, threadId);
    };
  return next;
}
