import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { app, shell } from "electron";
import type { Project, TaskWorktree, Thread } from "@artemis/protocol";
import {
  attachPermanentWorktree,
  createManagedWorktree,
  removeManagedWorktree as removeManagedWorktreeFromGit,
} from "../workspace/git-worktree.js";
import {
  assertConversationTarget,
  ensureTemporaryConversationWorkspace,
} from "../conversation/temporary-conversation.js";
import {
  resolveWorkspaceFileLink,
  type ResolvedWorkspaceFileLink,
} from "../workspace/workspace-file-link.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "store" | "managedWorktreeRoot" | "worktreeCapacity"
>;
export function createTaskWorkspaces(services: Dependencies) {
  const { managedWorktreeRoot, worktreeCapacity } = services;
  function pathIsInside(root: string, path: string): boolean {
    const relation = relative(resolve(root), resolve(path));
    return (
      relation !== "" &&
      relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation)
    );
  }

  function pathsEqual(left: string, right: string): boolean {
    const resolvedLeft = resolve(left);
    const resolvedRight = resolve(right);
    return process.platform === "win32"
      ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
      : resolvedLeft === resolvedRight;
  }

  function approvalProjectId(thread: Thread): string {
    return thread.projectId ?? `temporary:${thread.id}`;
  }

  async function resolveThreadWorkspace(thread: Thread): Promise<{
    project: Project;
    workspacePath: string;
    worktree?: TaskWorktree;
    temporary: boolean;
  }> {
    if (!services.store) {
      throw new Error("Application store is not ready.");
    }
    assertConversationTarget(thread.projectId, thread.target);
    if (!thread.projectId) {
      const workspacePath = await ensureTemporaryConversationWorkspace(
        app.getPath("userData"),
        thread.id,
      );
      return {
        project: {
          id: `temporary:${thread.id}`,
          name: "Temporary conversation",
          path: workspacePath,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        },
        workspacePath,
        temporary: true,
      };
    }
    const project = services.store.getProject(thread.projectId);
    if (!project) {
      throw new Error(`Project not found: ${thread.projectId}`);
    }
    if (thread.target === "local") {
      return { project, workspacePath: project.path, temporary: false };
    }
    const worktree = services.store.getWorktreeForThread(thread.id);
    if (!worktree || worktree.status !== "active") {
      throw new Error("Task worktree is not active.");
    }
    if (
      worktree.target === "managed-worktree" &&
      !pathIsInside(managedWorktreeRoot(project.id), worktree.path)
    ) {
      throw new Error("Managed worktree path is outside application storage.");
    }
    try {
      const worktreeStat = await stat(worktree.path);
      if (!worktreeStat.isDirectory()) {
        throw new Error("Task worktree path is not a directory.");
      }
    } catch (error) {
      services.store.updateWorktree(worktree.id, { status: "missing" });
      throw new Error(
        error instanceof Error
          ? `Task worktree is unavailable: ${error.message}`
          : "Task worktree is unavailable.",
      );
    }
    return {
      project,
      workspacePath: worktree.path,
      worktree,
      temporary: false,
    };
  }

  async function linkedWorkspaceFile(
    threadIdInput: string,
    hrefInput: string,
  ): Promise<ResolvedWorkspaceFileLink> {
    if (!services.store) throw new Error("Application store is not ready.");
    const thread = services.store.getThread(String(threadIdInput ?? ""));
    if (!thread || thread.archived) {
      throw new Error("Active task not found.");
    }
    const context = await resolveThreadWorkspace(thread);
    return resolveWorkspaceFileLink(
      context.workspacePath,
      String(hrefInput ?? ""),
    );
  }

  async function launchWorkspaceFile(
    file: ResolvedWorkspaceFileLink,
  ): Promise<void> {
    if (!file.executable) {
      throw new Error("The selected workspace file is not executable.");
    }
    if (process.platform === "win32") {
      const error = await shell.openPath(file.absolutePath);
      if (error) throw new Error(error);
      return;
    }

    await new Promise<void>((resolveLaunch, rejectLaunch) => {
      const child = spawn(file.absolutePath, [], {
        cwd: dirname(file.absolutePath),
        detached: true,
        stdio: "ignore",
      });
      child.once("error", rejectLaunch);
      child.once("spawn", () => {
        child.unref();
        resolveLaunch();
      });
    });
  }

  async function removeManagedWorktree(
    input: Parameters<typeof removeManagedWorktreeFromGit>[0],
  ): ReturnType<typeof removeManagedWorktreeFromGit> {
    const result = await removeManagedWorktreeFromGit(input);
    worktreeCapacity.release(basename(input.worktreePath));
    return result;
  }

  async function createManagedTaskWorktree(
    project: Project,
    threadId: string,
    startPoint?: string,
  ): Promise<TaskWorktree> {
    const release = worktreeCapacity.reserve(
      threadId,
      (services.store?.listWorktrees() ?? [])
        .filter(
          (item) =>
            item.target === "managed-worktree" && item.status === "active",
        )
        .map((item) => item.threadId),
    );
    let created;
    try {
      created = await createManagedWorktree({
        repositoryPath: project.path,
        managedRoot: managedWorktreeRoot(project.id),
        id: threadId,
        ...(startPoint ? { startPoint } : {}),
      });
    } catch (error) {
      release();
      throw error;
    }
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      threadId,
      projectId: project.id,
      path: created.path,
      target: "managed-worktree",
      head: created.head,
      ...(created.branch ? { branch: created.branch } : {}),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }

  async function createPermanentTaskWorktree(
    project: Project,
    threadId: string,
    worktreePath: string,
  ): Promise<TaskWorktree> {
    const attached = await attachPermanentWorktree({
      repositoryPath: project.path,
      worktreePath,
    });
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      threadId,
      projectId: project.id,
      path: attached.path,
      target: "permanent-worktree",
      head: attached.head,
      ...(attached.branch ? { branch: attached.branch } : {}),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    pathIsInside,
    pathsEqual,
    approvalProjectId,
    resolveThreadWorkspace,
    linkedWorkspaceFile,
    launchWorkspaceFile,
    removeManagedWorktree,
    createManagedTaskWorktree,
    createPermanentTaskWorktree,
  };
}
