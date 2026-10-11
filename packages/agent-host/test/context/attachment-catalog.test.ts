import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { estimateTextTokens, type PromptAttachment } from "@artemis/protocol";
import { appendPromptFiles } from "../../src/context/turn-prompt.js";
it("bounds the catalog independently of original count and size", () => {
  const refs: PromptAttachment[] = Array.from({ length: 1000 }, () => ({
    type: "attachment",
    id: randomUUID(),
    kind: "file",
    name: "中文文件.txt",
    mimeType: "text/plain",
    size: 2 ** 31,
    status: "pending",
  }));
  const prompt = appendPromptFiles("", refs);
  expect(estimateTextTokens(prompt)).toBeLessThanOrEqual(2000);
  expect(prompt).toContain("1000 total");
  expect(prompt).toContain("attachment_list");
});
