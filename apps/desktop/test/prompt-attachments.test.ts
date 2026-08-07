import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPromptAttachments } from "../src/main/prompt-attachments.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "artemis-attachments-"));
  temporaryDirectories.push(path);
  return path;
}

describe("loadPromptAttachments", () => {
  it("loads dropped images and UTF-8 files into one prompt attachment list", async () => {
    const root = await temporaryDirectory();
    const imagePath = join(root, "screen.png");
    const filePath = join(root, "notes.md");
    await writeFile(imagePath, Buffer.from("not-a-real-png"));
    await writeFile(filePath, "# Steps\n1. Drop the file\n", "utf8");

    const attachments = await loadPromptAttachments([imagePath, filePath]);

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      name: "screen.png",
      mimeType: "image/png",
    });
    expect(attachments[0]).toHaveProperty("data");
    expect(attachments[1]).toEqual({
      type: "file",
      name: "notes.md",
      mimeType: "text/markdown",
      content: "# Steps\n1. Drop the file\n",
    });
  });

  it("rejects unsupported binary files instead of pretending they are readable", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "archive.bin");
    await writeFile(path, Buffer.from([0, 1, 2, 3, 255]));

    await expect(loadPromptAttachments([path])).rejects.toThrow(
      "Unsupported binary attachment",
    );
  });

  it("enforces the shared attachment count limit", async () => {
    const root = await temporaryDirectory();
    const paths = await Promise.all(
      Array.from({ length: 11 }, async (_value, index) => {
        const path = join(root, `file-${index}.txt`);
        await writeFile(path, "content", "utf8");
        return path;
      }),
    );

    await expect(loadPromptAttachments(paths)).rejects.toThrow(
      "Attach no more than 10 files",
    );
  });
});
