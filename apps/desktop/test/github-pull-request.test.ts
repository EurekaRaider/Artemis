import { describe, expect, it, vi } from "vitest";

import {
  inspectProjectPullRequest,
  normalizeProjectPullRequestCheckStatus,
  parseProjectPullRequest,
} from "../src/main/github-pull-request.js";

const headRefOid = "a".repeat(40);

function pullRequestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 80,
    title: "Stop stalled model streams",
    url: "https://github.com/EurekaRaider/Artemis/pull/80",
    state: "OPEN",
    isDraft: false,
    headRefName: "codex/fix-stall",
    headRefOid,
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "Test, typecheck, build and format",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://github.com/example/actions/jobs/1",
        workflowName: "CI",
      },
      {
        __typename: "StatusContext",
        context: "Windows native sandbox integration",
        state: "PENDING",
        targetUrl: "https://github.com/example/actions/jobs/2",
      },
    ],
    ...overrides,
  });
}

function commandFailure(stderr: string, code: number | string = 1): Error {
  return Object.assign(new Error(stderr), { code, stderr });
}

describe("GitHub pull request lookup", () => {
  it("queries the exact current branch and normalizes check rollups", async () => {
    const runCommand = vi.fn(
      async (command: string, args: readonly string[], cwd: string) => {
        if (command === "git" && args[0] === "rev-parse") {
          expect(cwd).toBe("/workspace");
          return "/repo\n";
        }
        if (command === "git" && args[0] === "symbolic-ref") {
          expect(cwd).toBe("/repo");
          return "codex/fix-stall\n";
        }
        expect(command).toBe("gh");
        expect(args.slice(0, 4)).toEqual([
          "pr",
          "view",
          "codex/fix-stall",
          "--json",
        ]);
        expect(cwd).toBe("/repo");
        return pullRequestJson();
      },
    );

    await expect(
      inspectProjectPullRequest("/workspace", { runCommand }),
    ).resolves.toEqual({
      status: "found",
      pullRequest: expect.objectContaining({
        number: 80,
        headRefName: "codex/fix-stall",
        headRefOid,
        checks: [
          expect.objectContaining({ status: "passed" }),
          expect.objectContaining({ status: "pending" }),
        ],
      }),
    });
  });

  it("treats no PR, detached HEAD, and a mismatched branch as absent", async () => {
    const noPullRequest = vi.fn(
      async (command: string, args: readonly string[]) => {
        if (command === "git" && args[0] === "rev-parse") return "/repo\n";
        if (command === "git") return "main\n";
        throw commandFailure('no pull requests found for branch "main"');
      },
    );
    await expect(
      inspectProjectPullRequest("/workspace", { runCommand: noPullRequest }),
    ).resolves.toEqual({ status: "not-found" });

    const detached = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "git" && args[0] === "rev-parse") return "/repo\n";
      throw commandFailure("not a symbolic ref");
    });
    await expect(
      inspectProjectPullRequest("/workspace", { runCommand: detached }),
    ).resolves.toEqual({ status: "not-found" });

    const mismatch = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "git" && args[0] === "rev-parse") return "/repo\n";
      if (command === "git") return "feature/current\n";
      return pullRequestJson({ headRefName: "feature/other" });
    });
    await expect(
      inspectProjectPullRequest("/workspace", { runCommand: mismatch }),
    ).resolves.toEqual({ status: "not-found" });
  });

  it("reports missing gh and authentication separately", async () => {
    const lookup = (failure: Error) =>
      inspectProjectPullRequest("/workspace", {
        runCommand: vi.fn(async (command: string, args: readonly string[]) => {
          if (command === "git" && args[0] === "rev-parse") return "/repo\n";
          if (command === "git") return "feature/current\n";
          throw failure;
        }),
      });

    await expect(
      lookup(commandFailure("spawn gh ENOENT", "ENOENT")),
    ).resolves.toEqual({ status: "unavailable", reason: "gh-not-installed" });
    await expect(
      lookup(commandFailure("Run gh auth login to authenticate")),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "authentication-required",
    });
  });

  it("rejects malformed or unsafe pull request data", () => {
    expect(() => parseProjectPullRequest("not json")).toThrow(/invalid/iu);
    expect(() =>
      parseProjectPullRequest(pullRequestJson({ url: "file:///tmp/pr" })),
    ).toThrow(/invalid pull request URL/iu);
    expect(() =>
      parseProjectPullRequest(pullRequestJson({ headRefOid: "short" })),
    ).toThrow(/invalid head commit/iu);
  });

  it("normalizes every terminal check class without treating unknown states as passed", () => {
    expect(
      normalizeProjectPullRequestCheckStatus({
        __typename: "CheckRun",
        status: "COMPLETED",
        conclusion: "FAILURE",
      }),
    ).toBe("failed");
    expect(
      normalizeProjectPullRequestCheckStatus({
        __typename: "CheckRun",
        status: "COMPLETED",
        conclusion: "SKIPPED",
      }),
    ).toBe("skipped");
    expect(
      normalizeProjectPullRequestCheckStatus({
        __typename: "CheckRun",
        status: "COMPLETED",
        conclusion: "CANCELLED",
      }),
    ).toBe("cancelled");
    expect(
      normalizeProjectPullRequestCheckStatus({
        __typename: "CheckRun",
        status: "IN_PROGRESS",
      }),
    ).toBe("pending");
  });
});
