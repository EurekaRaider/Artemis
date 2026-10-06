import { isExecutionMode, type Thread } from "@artemis/protocol";
import type { PluginDispatchHost } from "./design-plugin-dispatch.js";
import { scanProjectDesignFiles } from "./design-plugin-project-files.js";
import {
  listDesignThinVersions,
  redoDesignThinVersion,
  restoreDesignThinVersion,
  undoDesignThinVersion,
  writeDesignWorkspacePage,
} from "./design-thin-snapshots.js";

export function createDesignWorkspaceToolHandlers(host: {
  getThread: (id: string) => Thread | undefined;
  resolveWorkspace: (thread: Thread) => Promise<{ workspacePath: string }>;
}): Pick<
  PluginDispatchHost,
  "getWorkspaceSnapshot" | "writeWorkspacePage" | "designVersionOp"
> {
  async function workspace(threadId: string) {
    const thread = host.getThread(threadId);
    if (!thread?.projectId || thread.archived || !isExecutionMode(thread.mode))
      throw new Error("Active execution-mode project task required.");
    const resolved = await host.resolveWorkspace(thread);
    const authorize = () => {
      const current = host.getThread(threadId);
      if (
        !current ||
        current.archived ||
        !isExecutionMode(current.mode) ||
        current.projectId !== thread.projectId ||
        current.target !== thread.target ||
        current.typeBinding?.bindingRevision !==
          thread.typeBinding?.bindingRevision
      )
        throw new Error("Task changed before file execution.");
    };
    authorize();
    return { ...resolved, authorize };
  }
  return {
    getWorkspaceSnapshot: async ({ threadId }) => {
      const resolved = await workspace(threadId);
      return {
        status: "succeeded",
        output: JSON.stringify({
          files: await scanProjectDesignFiles(resolved.workspacePath),
        }),
      };
    },
    writeWorkspacePage: async ({
      threadId,
      path,
      content,
      find,
      authorize,
    }) => {
      const resolved = await workspace(threadId);
      const check = async () => {
        await authorize?.();
        resolved.authorize();
      };
      return {
        ok: true,
        ...(await writeDesignWorkspacePage(
          resolved.workspacePath,
          path,
          content,
          find,
          check,
        )),
      };
    },
    designVersionOp: async ({
      threadId,
      toolName,
      path,
      revision,
      authorize,
    }) => {
      const resolved = await workspace(threadId);
      const check = async () => {
        await authorize?.();
        resolved.authorize();
      };
      if (toolName === "list_versions")
        return {
          ok: true,
          result: JSON.stringify({
            path,
            versions: await listDesignThinVersions(
              resolved.workspacePath,
              path,
            ),
          }),
        };
      if (toolName === "undo" || toolName === "redo") {
        const out = await (
          toolName === "undo" ? undoDesignThinVersion : redoDesignThinVersion
        )(resolved.workspacePath, path, check);
        return "error" in out
          ? { ok: false, error: out.error }
          : {
              ok: true,
              result: JSON.stringify({
                path,
                revision: out.revision,
                op: toolName,
              }),
            };
      }
      const versions = await listDesignThinVersions(
        resolved.workspacePath,
        path,
      );
      const target = revision
        ? versions.findLast((v) => v.revision === revision)
        : versions.at(-1);
      if (!target) return { ok: false, error: "Snapshot does not exist." };
      const content = await restoreDesignThinVersion(
        resolved.workspacePath,
        path,
        target.file,
        check,
      );
      return content === undefined
        ? { ok: false, error: "Snapshot is unreadable." }
        : {
            ok: true,
            result: JSON.stringify({
              path,
              revision: target.revision,
              op: toolName,
            }),
          };
    },
  };
}
