import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { readPromptAttachmentsFromFiles } from "../src/preload/prompt-attachments.js";

const preloadAttachmentSource = readFileSync(
  fileURLToPath(
    new URL("../src/preload/prompt-attachments.ts", import.meta.url),
  ),
  "utf8",
);

describe("preload prompt attachments", () => {
  it("uses no Node built-ins in the sandboxed preload", () => {
    expect(preloadAttachmentSource).not.toMatch(/from ["']node:/u);
  });

  it("preserves clipboard order for local files and in-memory images", async () => {
    const localFile = new File(["# Notes"], "notes.md", {
      type: "text/markdown",
    });
    const imageBytes = Uint8Array.from([137, 80, 78, 71]);
    const pastedImage = new File([imageBytes], "pasted-image.png", {
      type: "image/png",
    });
    const loadPaths = vi.fn(async () => [
      {
        type: "file" as const,
        name: "notes.md",
        mimeType: "text/markdown",
        content: "# Notes",
      },
    ]);

    const attachments = await readPromptAttachmentsFromFiles(
      [pastedImage, localFile],
      (file) => (file === localFile ? "C:\\project\\notes.md" : ""),
      loadPaths,
    );

    expect(loadPaths).toHaveBeenCalledWith(["C:\\project\\notes.md"]);
    expect(attachments).toEqual([
      {
        name: "pasted-image.png",
        mimeType: "image/png",
        data: Buffer.from(imageBytes).toString("base64"),
      },
      {
        type: "file",
        name: "notes.md",
        mimeType: "text/markdown",
        content: "# Notes",
      },
    ]);
  });

  it("rejects a pathless clipboard item that is not a supported image", async () => {
    const pathlessFile = new File(["notes"], "notes.txt", {
      type: "text/plain",
    });

    await expect(
      readPromptAttachmentsFromFiles(
        [pathlessFile],
        () => "",
        async () => [],
      ),
    ).rejects.toThrow("does not have a local path");
  });
});
