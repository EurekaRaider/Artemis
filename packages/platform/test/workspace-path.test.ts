import { mkdirSync, symlinkSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspacePathError, resolveWorkspacePath } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("resolveWorkspacePath", () => {
  it("accepts a new file under the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-workspace-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, "src"));

    expect(resolveWorkspacePath(root, "src/new.ts")).toBe(
      join(await realpath(root), "src", "new.ts"),
    );
  });

  it("rejects lexical traversal outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-workspace-"));
    temporaryDirectories.push(root);

    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow(
      WorkspacePathError,
    );
  });

  it("rejects links that escape the workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "artemis-parent-"));
    const root = join(parent, "workspace");
    const outside = join(parent, "outside");
    temporaryDirectories.push(parent);
    mkdirSync(root);
    mkdirSync(outside);
    symlinkSync(outside, join(root, "escape"), "junction");

    expect(() => resolveWorkspacePath(root, "escape/secret.txt")).toThrow(
      WorkspacePathError,
    );
  });
});
