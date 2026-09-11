import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WebContents } from "electron";
import { IPC } from "../shared/api.js";
import type { ProjectGitInfo } from "../shared/api.js";
import {
  gitRepositoryWatchPaths,
  gitRepositoryMetadataSignature,
  inspectGitBranches,
} from "./git-branches.js";

const projectGitWatchers = new Map<
  string,
  {
    workspacePath: string;
    closed: boolean;
    watchers: FSWatcher[];
    signature: string;
    metadataSignature: string;
    pendingKinds: Set<"metadata" | "worktree">;
    refreshing: boolean;
    timer?: NodeJS.Timeout;
  }
>();
const projectGitWatcherSenders = new Set<number>();
export function closeProjectGitWatchersForSender(senderId: number): void {
  for (const [key, registration] of projectGitWatchers) {
    if (!key.startsWith(`${senderId}\0`)) continue;
    registration.closed = true;
    if (registration.timer) clearTimeout(registration.timer);
    for (const watcher of registration.watchers) watcher.close();
    projectGitWatchers.delete(key);
  }
  projectGitWatcherSenders.delete(senderId);
}

export async function ensureProjectGitWatcher(
  sender: WebContents,
  projectId: string,
  threadId: string | undefined,
  workspacePath: string,
  initialInfo: ProjectGitInfo,
): Promise<void> {
  const key = `${sender.id}\0${projectId}\0${threadId ?? ""}`;
  workspacePath = resolve(workspacePath);
  const previous = projectGitWatchers.get(key);
  if (previous?.workspacePath === workspacePath && !previous.closed) return;
  if (previous) {
    previous.closed = true;
    if (previous.timer) clearTimeout(previous.timer);
    for (const watcher of previous.watchers) watcher.close();
  }
  const registration: {
    workspacePath: string;
    closed: boolean;
    watchers: FSWatcher[];
    signature: string;
    metadataSignature: string;
    pendingKinds: Set<"metadata" | "worktree">;
    refreshing: boolean;
    timer?: NodeJS.Timeout;
  } = {
    workspacePath,
    closed: false,
    watchers: [],
    signature: JSON.stringify(initialInfo),
    metadataSignature: "",
    pendingKinds: new Set(),
    refreshing: false,
  };
  projectGitWatchers.set(key, registration);
  let plan;
  try {
    plan = await gitRepositoryWatchPaths(workspacePath);
    if (plan)
      registration.metadataSignature =
        await gitRepositoryMetadataSignature(plan);
  } catch {
    // A later read can retry initialization if the repository was unavailable.
  }
  if (registration.closed) return;
  if (!plan) {
    projectGitWatchers.delete(key);
    return;
  }
  const refresh = async () => {
    if (registration.closed || registration.refreshing) return;
    registration.refreshing = true;
    const pendingKinds = new Set(registration.pendingKinds);
    registration.pendingKinds.clear();
    try {
      const metadataSignature = await gitRepositoryMetadataSignature(plan);
      if (
        pendingKinds.size === 1 &&
        pendingKinds.has("metadata") &&
        metadataSignature === registration.metadataSignature
      ) {
        return;
      }
      let signature: string;
      try {
        signature = JSON.stringify(await inspectGitBranches(workspacePath));
      } catch {
        signature = "unavailable";
      }
      if (registration.closed) return;
      // Only acknowledge the metadata sampled before this inspection. A change
      // during inspection must remain eligible for the queued refresh.
      registration.metadataSignature = metadataSignature;
      if (signature === registration.signature) return;
      registration.signature = signature;
      if (!sender.isDestroyed()) {
        sender.send(IPC.projectGitChanged, {
          projectId,
          ...(threadId ? { threadId } : {}),
        });
      }
    } catch {
      // Keep the previous signature so a subsequent event/read can retry.
    } finally {
      registration.refreshing = false;
      if (
        !registration.closed &&
        registration.pendingKinds.size > 0 &&
        !registration.timer
      ) {
        registration.timer = setTimeout(() => {
          delete registration.timer;
          void refresh();
        }, 1_000);
      }
    }
  };
  const changed = (kind: "metadata" | "worktree") => {
    if (registration.closed) return;
    registration.pendingKinds.add(kind);
    if (registration.timer) clearTimeout(registration.timer);
    registration.timer = setTimeout(() => {
      delete registration.timer;
      void refresh();
    }, 1_000);
  };
  const insideMetadataDirectory = (path: string) =>
    [plan.gitDirectory, plan.commonDirectory].some((directory) => {
      const pathFromDirectory = relative(directory, path);
      return (
        pathFromDirectory === "" ||
        (!pathFromDirectory.startsWith(`..${sep}`) &&
          pathFromDirectory !== ".." &&
          !isAbsolute(pathFromDirectory))
      );
    });
  const worktreeChanged = (
    _eventType: string,
    filename: string | Buffer | null,
  ) => {
    if (filename) {
      const changedPath = resolve(plan.root, filename.toString());
      if (insideMetadataDirectory(changedPath)) return;
    }
    changed("worktree");
  };
  const metadataNames = new Set([
    "HEAD",
    "index",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "config.worktree",
  ]);
  const commonMetadataNames = new Set(["config", "packed-refs"]);
  const metadataChanged =
    (acceptedNames: ReadonlySet<string> | undefined) =>
    (_eventType: string, filename: string | Buffer | null) => {
      if (acceptedNames && filename) {
        const topLevelName = filename.toString().split(/[\\/]/u, 1)[0];
        if (!topLevelName || !acceptedNames.has(topLevelName)) return;
      }
      changed("metadata");
    };
  const watchPath = (
    path: string,
    recursive: boolean,
    listener: (eventType: string, filename: string | Buffer | null) => void,
  ) => {
    try {
      registration.watchers.push(watch(path, { recursive }, listener));
    } catch {
      try {
        registration.watchers.push(watch(path, listener));
      } catch {
        // A disappearing Git metadata path will be recovered on the next read.
      }
    }
  };
  watchPath(plan.root, true, worktreeChanged);
  watchPath(plan.gitDirectory, false, metadataChanged(metadataNames));
  if (plan.commonDirectory !== plan.gitDirectory) {
    watchPath(
      plan.commonDirectory,
      false,
      metadataChanged(commonMetadataNames),
    );
  } else {
    for (const name of commonMetadataNames) metadataNames.add(name);
  }
  watchPath(
    join(plan.commonDirectory, "refs"),
    true,
    metadataChanged(undefined),
  );
  if (registration.watchers.length === 0) {
    projectGitWatchers.delete(key);
    return;
  }
  changed("worktree");
  if (!projectGitWatcherSenders.has(sender.id)) {
    projectGitWatcherSenders.add(sender.id);
    sender.once("destroyed", () => closeProjectGitWatchersForSender(sender.id));
  }
}
