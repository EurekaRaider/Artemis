import { describe, expect, it } from "vitest";
import { createAttachmentTools } from "../../src/tools/attachment-tools.js";
import images from "../fixtures/read-images.json";

describe("attachment Codemode results", () => {
  it("returns the image block to scripts and preserves the existing attachment note", async () => {
    const data = {
      id: "picture",
      ...images.png,
      originalWidth: 2,
      originalHeight: 2,
    };
    const tool = createAttachmentTools(async () => data).find(
      (tool) => tool.name === "attachment_read",
    )!;
    const result = await tool.execute("read", { id: "picture" });
    expect(tool.outputSchema).toBeDefined();
    expect(result.structuredContent).toEqual({
      type: "image",
      data: images.png.data,
      mimeType: "image/png",
      note: "[artemis-attachment id=picture original=2x2 displayed=2x2]",
    });
    expect(result.details).toEqual({ ...data, data: undefined });
  });
  it("keeps text, list and search results as their existing JSON strings", async () => {
    const data = { id: "text", text: "hello", nextOffset: 5 };
    for (const tool of createAttachmentTools(async () => data)) {
      const result = await tool.execute("read", {});
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(data) },
      ]);
      if (tool.name === "attachment_read")
        expect(result.structuredContent).toBe(JSON.stringify(data));
      else expect(tool.outputSchema).toBeUndefined();
    }
  });
});
