import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import type { ProjectGitInfo } from "../src/shared/api.js";
const mocks = vi.hoisted(() => ({
  watches: [] as {
    path: string;
    listener: (kind: string, name: string) => void;
    close: ReturnType<typeof vi.fn>;
  }[],
  inspect: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("node:fs", () => ({
  watch: (
    path: string,
    options: unknown,
    listener: (kind: string, name: string) => void,
  ) => {
    const entry = { path, listener, close: vi.fn() };
    mocks.watches.push(entry);
    return entry;
  },
}));
vi.mock("../src/main/git-branches.js", () => ({
  gitRepositoryWatchPaths: async (root: string) => ({
    root,
    gitDirectory: root + "/.git",
    commonDirectory: root + "/.git",
  }),
  gitRepositoryMetadataSignature: mocks.metadata,
  inspectGitBranches: mocks.inspect,
}));
import {
  ensureProjectGitWatcher,
  closeProjectGitWatchersForSender,
} from "../src/main/project-git-watcher.js";
const sender = {
  id: 42,
  isDestroyed: () => false,
  send: vi.fn(),
  once: vi.fn(),
} as unknown as WebContents;
const info = { currentBranch: "old" } as ProjectGitInfo;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.watches.length = 0;
  vi.clearAllMocks();
  mocks.metadata.mockResolvedValue("metadata");
  mocks.inspect.mockResolvedValue({ currentBranch: "next" });
});
afterEach(() => {
  closeProjectGitWatchersForSender(42);
  vi.useRealTimers();
});
it("rebinds the same task to each new checkout and closes old subscriptions", async () => {
  await ensureProjectGitWatcher(sender, "p", "t", "/local", info);
  const old = [...mocks.watches];
  await ensureProjectGitWatcher(sender, "p", "t", "/worktree", info);
  expect(old.every((w) => w.close.mock.calls.length === 1)).toBe(true);
  const current = mocks.watches.find((w) => w.path === "/worktree")!;
  expect(current).toBeDefined();
  current.listener("change", "file.ts");
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.inspect).toHaveBeenCalledWith("/worktree");
  expect(sender.send).toHaveBeenCalledTimes(1);
  await ensureProjectGitWatcher(sender, "p", "t", "/local", info);
  expect(current.close).toHaveBeenCalledOnce();
});
it("discards a refresh still running for the previous checkout", async () => {
  let complete!: (value: ProjectGitInfo) => void;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await ensureProjectGitWatcher(sender, "p", "t", "/local", info);
  mocks.watches[0]!.listener("change", "file.ts");
  await vi.advanceTimersByTimeAsync(1000);
  await ensureProjectGitWatcher(sender, "p", "t", "/worktree", info);
  complete({ currentBranch: "stale" } as ProjectGitInfo);
  await vi.advanceTimersByTimeAsync(0);
  expect(sender.send).not.toHaveBeenCalled();
});

it("does not swallow metadata changes arriving during an inspection", async () => {
  await ensureProjectGitWatcher(sender, "p", "t", "/local", info);
  await vi.advanceTimersByTimeAsync(1000);
  vi.mocked(sender.send).mockClear();
  mocks.inspect.mockClear();
  const metadata = mocks.watches.find((w) => w.path === "/local/.git")!;
  mocks.metadata.mockResolvedValue("branch-b");
  mocks.inspect
    .mockImplementationOnce(async () => {
      mocks.metadata.mockResolvedValue("branch-c");
      metadata.listener("change", "HEAD");
      return { currentBranch: "b" };
    })
    .mockResolvedValue({ currentBranch: "c" });
  metadata.listener("change", "HEAD");
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.inspect).toHaveBeenCalledTimes(2);
  expect(sender.send).toHaveBeenCalledTimes(2);
});
