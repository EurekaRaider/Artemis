import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  readWorkspaceImage,
  readWorkspaceTextFile,
} from "../src/main/workspace-text-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "artemis-preview-"));
  temporaryDirectories.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  return { root, workspace };
}

describe("workspace text file reader", () => {
  it("reads only supported HTML and Markdown files inside the workspace", async () => {
    const { workspace } = await createWorkspace();
    await writeFile(
      join(workspace, "preview.html"),
      "<h1>Preview</h1>",
      "utf8",
    );
    await writeFile(join(workspace, "notes.md"), "# Notes", "utf8");

    await expect(
      readWorkspaceTextFile(workspace, "preview.html"),
    ).resolves.toEqual({
      path: "preview.html",
      kind: "html",
      content: "<h1>Preview</h1>",
    });
    await expect(readWorkspaceTextFile(workspace, "notes.md")).resolves.toEqual(
      {
        path: "notes.md",
        kind: "markdown",
        content: "# Notes",
      },
    );
  });

  it("rejects unsupported files and paths outside the task workspace", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(workspace, "notes.txt"), "plain", "utf8");
    await writeFile(join(root, "outside.html"), "<p>outside</p>", "utf8");

    await expect(readWorkspaceTextFile(workspace, "notes.txt")).rejects.toThrow(
      "HTML or Markdown",
    );
    await expect(
      readWorkspaceTextFile(workspace, "../outside.html"),
    ).rejects.toThrow("outside the workspace");
  });

  it("lists the current workspace directory and reads ordinary text files", async () => {
    const { workspace } = await createWorkspace();
    await mkdir(join(workspace, "apps"));
    await writeFile(
      join(workspace, "package.json"),
      '{"private":true}',
      "utf8",
    );

    await expect(listWorkspaceDirectory(workspace, "")).resolves.toEqual([
      {
        name: "apps",
        path: "apps",
        kind: "directory",
      },
      {
        name: "package.json",
        path: "package.json",
        kind: "file",
      },
    ]);
    await expect(readWorkspaceFile(workspace, "package.json")).resolves.toEqual(
      {
        path: "package.json",
        binary: false,
        content: '{"private":true}',
      },
    );
  });

  it("reads Markdown images relative to their document without escaping the workspace", async () => {
    const { root, workspace } = await createWorkspace();
    await mkdir(join(workspace, "docs"));
    await mkdir(join(workspace, "assets"));
    await writeFile(join(workspace, "docs", "README.md"), "# Docs", "utf8");
    await writeFile(
      join(workspace, "assets", "system diagram.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    await writeFile(join(root, "outside.png"), "outside", "utf8");

    await expect(
      readWorkspaceImage(
        workspace,
        "docs/README.md",
        "../assets/system%20diagram.png?raw=1",
      ),
    ).resolves.toEqual({
      path: "assets/system diagram.png",
      mimeType: "image/png",
      data: "iVBORw==",
    });
    await expect(
      readWorkspaceImage(workspace, "docs/README.md", "../../outside.png"),
    ).rejects.toThrow("outside the workspace");
    await expect(
      readWorkspaceImage(
        workspace,
        "docs/README.md",
        "https://example.com/image.png",
      ),
    ).rejects.toThrow("local workspace image");
  });

  it("uses the image signature when a Markdown image has the wrong extension", async () => {
    const { workspace } = await createWorkspace();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    await writeFile(join(workspace, "preview.jpg"), png);

    await expect(
      readWorkspaceImage(workspace, "README.md", "preview.jpg"),
    ).resolves.toEqual({
      path: "preview.jpg",
      mimeType: "image/png",
      data: png.toString("base64"),
    });
  });
});
