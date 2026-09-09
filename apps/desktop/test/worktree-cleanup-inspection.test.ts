import { describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  return {
    ...actual,
    execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }),
  };
});
import { inspectWorktreeCleanup } from "../src/main/git-worktree.js";
function responses({
  remote = "https://github.com/example/repo.git",
  dirty = false,
  unavailable = false,
  ancestor = true,
} = {}) {
  execute
    .mockReset()
    .mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "status")
        return { stdout: dirty ? "?? local.txt\n" : "" };
      if (args.length === 1 && args[0] === "remote")
        return { stdout: "origin\n" };
      if (args[0] === "remote") return { stdout: remote };
      if (args[0] === "ls-remote") {
        if (unavailable) throw new Error("Network unavailable");
        return { stdout: `${"a".repeat(40)}\trefs/heads/main\n` };
      }
      if (args[0] === "merge-base" && !ancestor)
        throw new Error("Not an ancestor");
      return { stdout: "" };
    });
}
describe("worktree cleanup remote evidence", () => {
  it("checks current GitHub tips and commit ancestry", async () => {
    responses();
    expect(await inspectWorktreeCleanup("/fixture")).toEqual({
      clean: true,
      pushedToGitHub: true,
    });
    expect(execute).toHaveBeenCalledWith(
      "git",
      ["ls-remote", "--heads", "https://github.com/example/repo.git"],
      expect.anything(),
    );
    expect(execute).toHaveBeenCalledWith(
      "git",
      ["merge-base", "--is-ancestor", "HEAD", "a".repeat(40)],
      expect.anything(),
    );
  });
  it("does not claim remote safety for unpushed commits or offline GitHub", async () => {
    responses({ ancestor: false });
    expect((await inspectWorktreeCleanup("/fixture")).pushedToGitHub).toBe(
      false,
    );
    responses({ unavailable: true });
    expect(await inspectWorktreeCleanup("/fixture")).toMatchObject({
      clean: true,
      pushedToGitHub: false,
      error: expect.any(String),
    });
  });
  it("rejects lookalike hosts and includes ignored files in local checks", async () => {
    responses({
      remote: "https://github.com.example.org/example/repo.git",
      dirty: true,
    });
    expect(await inspectWorktreeCleanup("/fixture")).toEqual({
      clean: false,
      pushedToGitHub: false,
    });
    expect(execute.mock.calls.some((call) => call[1][0] === "ls-remote")).toBe(
      false,
    );
    expect(execute.mock.calls[0]![1]).toContain("--ignored");
  });
});
