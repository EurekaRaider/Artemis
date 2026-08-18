import { cp, mkdir, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { Thread, WorkspaceTarget } from "@artemis/protocol";

export type ConversationApprovalScope = "once" | "session" | "project";
export type ConversationMemoryScope = "project" | "global";

type ConversationIdentity = Pick<Thread, "id" | "projectId">;

export function temporaryConversationRoot(userDataPath: string): string {
  return resolve(userDataPath, "temporary-conversations");
}

export function temporaryConversationWorkspace(
  userDataPath: string,
  threadId: string,
): string {
  if (!threadId) throw new Error("Temporary conversation ID is required.");
  const root = temporaryConversationRoot(userDataPath);
  const workspace = resolve(root, threadId);
  const relation = relative(root, workspace);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error("Temporary conversation workspace is invalid.");
  }
  return workspace;
}

export function assertConversationTarget(
  projectId: string | undefined,
  target: WorkspaceTarget,
): void {
  if (!projectId && target !== "local") {
    throw new Error("Temporary conversations support only the Local target.");
  }
}

export function conversationWorkspaceMatches(
  expectedWorkspace: string,
  requestedWorkspace: string,
  platform = process.platform,
): boolean {
  const expected = resolve(expectedWorkspace);
  const requested = resolve(requestedWorkspace);
  return platform === "win32"
    ? expected.toLowerCase() === requested.toLowerCase()
    : expected === requested;
}

export function conversationApprovalScopes(
  thread: ConversationIdentity,
  scopes: readonly ConversationApprovalScope[],
): ConversationApprovalScope[] {
  return scopes.filter(
    (scope) => scope !== "project" || Boolean(thread.projectId),
  );
}

export function conversationMemoryScopeAllowed(
  thread: ConversationIdentity,
  scope: ConversationMemoryScope,
): boolean {
  return Boolean(thread.projectId) || scope === "global";
}

export function conversationSupportsProjectFeatures(
  thread: ConversationIdentity,
): boolean {
  return Boolean(thread.projectId);
}

export async function ensureTemporaryConversationWorkspace(
  userDataPath: string,
  threadId: string,
): Promise<string> {
  const workspace = temporaryConversationWorkspace(userDataPath, threadId);
  await mkdir(workspace, { recursive: true });
  return workspace;
}

export async function removeTemporaryConversationWorkspace(
  userDataPath: string,
  threadId: string,
): Promise<void> {
  await rm(temporaryConversationWorkspace(userDataPath, threadId), {
    recursive: true,
    force: true,
  });
}

export async function copyTemporaryConversationWorkspace(
  userDataPath: string,
  sourceThreadId: string,
  targetThreadId: string,
): Promise<string> {
  if (sourceThreadId === targetThreadId) {
    throw new Error("Temporary conversation fork requires a new thread ID.");
  }
  const source = temporaryConversationWorkspace(userDataPath, sourceThreadId);
  const target = temporaryConversationWorkspace(userDataPath, targetThreadId);
  try {
    await stat(target);
    throw new Error("Temporary conversation fork workspace already exists.");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  try {
    await cp(source, target, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  } catch (error) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Temporary conversation fork failed and its copied workspace could not be removed.",
      );
    }
    throw error;
  }
  return target;
}
