import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertConversationTarget,
  conversationApprovalScopes,
  conversationMemoryScopeAllowed,
  conversationSupportsProjectFeatures,
  conversationWorkspaceMatches,
  copyTemporaryConversationWorkspace,
  ensureTemporaryConversationWorkspace,
  removeTemporaryConversationWorkspace,
  temporaryConversationWorkspace,
} from "../src/main/temporary-conversation.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const projectThread = { id: "project-thread", projectId: "project-1" };
const temporaryThread = { id: "temporary-thread" };

describe("temporary conversation policy", () => {
  it("allows projectless conversations only on the Local target", () => {
    expect(() => assertConversationTarget(undefined, "local")).not.toThrow();
    expect(() =>
      assertConversationTarget(undefined, "managed-worktree"),
    ).toThrow("only the Local target");
    expect(() =>
      assertConversationTarget(undefined, "permanent-worktree"),
    ).toThrow("only the Local target");
    expect(() =>
      assertConversationTarget("project-1", "managed-worktree"),
    ).not.toThrow();
  });

  it("requires an exact workspace for every broker path", () => {
    const expected = join(tmpdir(), "artemis-temporary", "thread-1");
    expect(conversationWorkspaceMatches(expected, expected)).toBe(true);
    expect(
      conversationWorkspaceMatches(expected, join(expected, "child")),
    ).toBe(false);
    expect(
      conversationWorkspaceMatches(expected, join(expected, "..", "thread-2")),
    ).toBe(false);
    expect(
      conversationWorkspaceMatches(
        "C:\\Temp\\Thread",
        "c:\\temp\\thread",
        "win32",
      ),
    ).toBe(true);
  });

  it("removes project approval scope only for projectless conversations", () => {
    const scopes = ["once", "session", "project"] as const;
    expect(conversationApprovalScopes(temporaryThread, scopes)).toEqual([
      "once",
      "session",
    ]);
    expect(conversationApprovalScopes(projectThread, scopes)).toEqual(scopes);
  });

  it("allows global memory but rejects project memory and project features", () => {
    expect(conversationMemoryScopeAllowed(temporaryThread, "global")).toBe(
      true,
    );
    expect(conversationMemoryScopeAllowed(temporaryThread, "project")).toBe(
      false,
    );
    expect(conversationMemoryScopeAllowed(projectThread, "project")).toBe(true);
    expect(conversationSupportsProjectFeatures(temporaryThread)).toBe(false);
    expect(conversationSupportsProjectFeatures(projectThread)).toBe(true);
  });

  it("rejects thread IDs that escape the generated workspace root", () => {
    expect(() =>
      temporaryConversationWorkspace("/tmp/artemis-user-data", "../escape"),
    ).toThrow("workspace is invalid");
    expect(() =>
      temporaryConversationWorkspace("/tmp/artemis-user-data", "/escape"),
    ).toThrow("workspace is invalid");
  });
});

describe("temporary conversation workspace lifecycle", () => {
  it("copies fork files independently and deletes only the requested thread", async () => {
    const userData = await mkdtemp(join(tmpdir(), "artemis-temporary-policy-"));
    temporaryDirectories.push(userData);
    const source = await ensureTemporaryConversationWorkspace(
      userData,
      "source-thread",
    );
    await writeFile(join(source, "artifact.txt"), "source", "utf8");

    const fork = await copyTemporaryConversationWorkspace(
      userData,
      "source-thread",
      "fork-thread",
    );
    expect(await readFile(join(fork, "artifact.txt"), "utf8")).toBe("source");

    await writeFile(join(fork, "artifact.txt"), "fork", "utf8");
    expect(await readFile(join(source, "artifact.txt"), "utf8")).toBe("source");

    await removeTemporaryConversationWorkspace(userData, "source-thread");
    await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(fork, "artifact.txt"), "utf8")).toBe("fork");

    await removeTemporaryConversationWorkspace(userData, "fork-thread");
    await expect(stat(fork)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite or remove an existing fork workspace", async () => {
    const userData = await mkdtemp(join(tmpdir(), "artemis-temporary-policy-"));
    temporaryDirectories.push(userData);
    await ensureTemporaryConversationWorkspace(userData, "source-thread");
    const existing = await ensureTemporaryConversationWorkspace(
      userData,
      "fork-thread",
    );
    await writeFile(join(existing, "keep.txt"), "keep", "utf8");

    await expect(
      copyTemporaryConversationWorkspace(
        userData,
        "source-thread",
        "fork-thread",
      ),
    ).rejects.toThrow("already exists");
    expect(await readFile(join(existing, "keep.txt"), "utf8")).toBe("keep");
  });
});
