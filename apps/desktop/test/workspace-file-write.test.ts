import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as workspaceTextFiles from "../src/main/workspace-text-file.js";

type WorkspaceTextFileModule = typeof workspaceTextFiles & {
  writeWorkspaceFile?: (
    workspacePath: string,
    path: string,
    content: string,
  ) => Promise<void>;
};

const writeWorkspaceFile = (workspaceTextFiles as WorkspaceTextFileModule)
  .writeWorkspaceFile;

describe("workspace file writes", () => {
  it("persists edited UTF-8 text through the path-scoped workspace helper", async () => {
    expect(writeWorkspaceFile).toBeTypeOf("function");
    if (!writeWorkspaceFile) return;

    const workspacePath = await mkdtemp(
      join(tmpdir(), "artemis-workspace-write-"),
    );
    const filePath = join(workspacePath, "notes.txt");

    try {
      await writeFile(filePath, "before", "utf8");

      await writeWorkspaceFile(
        workspacePath,
        "notes.txt",
        "第一行\nconst answer = 42;\n",
      );

      expect(await readFile(filePath, "utf8")).toBe(
        "第一行\nconst answer = 42;\n",
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("rejects writes outside the workspace and to an existing binary file", async () => {
    expect(writeWorkspaceFile).toBeTypeOf("function");
    if (!writeWorkspaceFile) return;

    const root = await mkdtemp(
      join(tmpdir(), "artemis-workspace-write-boundary-"),
    );
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    await writeFile(join(root, "outside.txt"), "outside", "utf8");
    await writeFile(join(workspacePath, "image.bin"), Buffer.from([1, 0, 2]));

    try {
      await expect(
        writeWorkspaceFile(workspacePath, "../outside.txt", "changed"),
      ).rejects.toThrow("outside the workspace");
      await expect(
        writeWorkspaceFile(workspacePath, "image.bin", "changed"),
      ).rejects.toThrow("Binary workspace files");
      expect(await readFile(join(root, "outside.txt"), "utf8")).toBe("outside");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
