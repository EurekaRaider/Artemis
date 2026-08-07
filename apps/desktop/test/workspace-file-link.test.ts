import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  isWorkspaceFileExecutable,
  resolveWorkspaceFileLink,
  workspaceFileViewer,
} from "../src/main/workspace-file-link.js";

const temporaryDirectories: string[] = [];

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "artemis-file-link-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "docs"), { recursive: true });
  await mkdir(join(workspace, "reports"), { recursive: true });
  await writeFile(join(workspace, "docs", "guide.md"), "# Guide", "utf8");
  await writeFile(
    join(workspace, "reports", "My Report.html"),
    "<h1>Report</h1>",
    "utf8",
  );
  await writeFile(join(workspace, "main.ts"), "export {};", "utf8");
  return { root, workspace };
}

describe("workspace file links", () => {
  it("resolves relative, encoded, absolute, and line-addressed links", async () => {
    const { workspace } = await createWorkspace();

    await expect(
      resolveWorkspaceFileLink(workspace, "docs/guide.md"),
    ).resolves.toMatchObject({
      path: "docs/guide.md",
      viewer: "markdown",
      executable: false,
    });
    await expect(
      resolveWorkspaceFileLink(workspace, "reports/My%20Report.html"),
    ).resolves.toMatchObject({
      path: "reports/My Report.html",
      viewer: "browser",
    });
    await expect(
      resolveWorkspaceFileLink(workspace, `${join(workspace, "main.ts")}:12:4`),
    ).resolves.toMatchObject({
      path: "main.ts",
      viewer: "file",
      line: 12,
      column: 4,
    });
    await expect(
      resolveWorkspaceFileLink(
        workspace,
        `${pathToFileURL(join(workspace, "docs", "guide.md")).href}#L2C3`,
      ),
    ).resolves.toMatchObject({
      path: "docs/guide.md",
      line: 2,
      column: 3,
    });
  });

  it("rejects missing files, directories, URLs, and workspace escapes", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, "outside.md"), "outside", "utf8");

    await expect(
      resolveWorkspaceFileLink(workspace, "missing.ts"),
    ).rejects.toThrow();
    await expect(resolveWorkspaceFileLink(workspace, "docs")).rejects.toThrow(
      "not a file",
    );
    await expect(
      resolveWorkspaceFileLink(workspace, "https://example.com/file.ts"),
    ).rejects.toThrow("Only local workspace file links");
    await expect(
      resolveWorkspaceFileLink(workspace, "../outside.md"),
    ).rejects.toThrow("outside the workspace");
  });

  it("classifies readers and executable files without relying on the renderer", () => {
    expect(workspaceFileViewer("README.md")).toBe("markdown");
    expect(workspaceFileViewer("site.HTML")).toBe("browser");
    expect(workspaceFileViewer("src/main.ts")).toBe("file");

    expect(isWorkspaceFileExecutable("tool.exe", 0, "win32")).toBe(true);
    expect(isWorkspaceFileExecutable("tool.CMD", 0, "win32")).toBe(true);
    expect(isWorkspaceFileExecutable("tool.ps1", 0, "win32")).toBe(false);
    expect(isWorkspaceFileExecutable("tool", 0o755, "darwin")).toBe(true);
    expect(isWorkspaceFileExecutable("tool", 0o644, "linux")).toBe(false);
  });

  it("marks a real executable only after reading its filesystem mode", async () => {
    const { workspace } = await createWorkspace();
    const executable = join(
      workspace,
      process.platform === "win32" ? "launch.cmd" : "launch.sh",
    );
    await writeFile(executable, "#!/bin/sh\nexit 0\n", "utf8");
    if (process.platform !== "win32") await chmod(executable, 0o755);

    await expect(
      resolveWorkspaceFileLink(workspace, executable),
    ).resolves.toMatchObject({ executable: true });
  });

  it("keeps reveal and execution behind validated main-process IPC", () => {
    const appSource = source("../src/renderer/App.tsx");
    const mainSource = source("../src/main/main.ts");
    const preloadSource = source("../src/preload/preload.ts");
    const apiSource = source("../src/shared/api.ts");

    expect(appSource).toContain("inspectWorkspaceFileLink(");
    expect(appSource).toContain("openWorkspaceTab(file.viewer");
    expect(appSource).toContain("fileLinkContextMenu.file.executable");
    expect(appSource).toContain("revealWorkspaceFile(");
    expect(appSource).toContain("runWorkspaceFile(");
    expect(preloadSource).toContain("IPC.workspaceFileLinkInspect");
    expect(preloadSource).toContain("IPC.workspaceFileReveal");
    expect(preloadSource).toContain("IPC.workspaceFileRun");
    expect(apiSource).toContain(
      'workspaceFileLinkInspect: "artemis:workspace-file-link-inspect"',
    );
    expect(mainSource).toContain("await linkedWorkspaceFile(threadId, href)");
    expect(mainSource).toContain("shell.showItemInFolder(file.absolutePath)");
    expect(mainSource).toContain("if (!file.executable)");
    expect(mainSource).toContain("spawn(file.absolutePath, []");
  });
});
