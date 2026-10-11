import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { promptAttachmentsSchema } from "../src/schema.js";
it("decouples local original references from inline message quotas", () => {
  const refs = Array.from({ length: 1000 }, () => ({
    type: "attachment",
    id: randomUUID(),
    kind: "file",
    name: "large.txt",
    mimeType: "text/plain",
    size: 2 ** 31,
    status: "pending",
  }));
  expect(promptAttachmentsSchema.safeParse(refs).success).toBe(true);
  expect(
    promptAttachmentsSchema.safeParse([
      { ...refs[0], size: Number.MAX_SAFE_INTEGER + 1 },
    ]).success,
  ).toBe(false);
  const inline = {
    type: "file",
    name: "text",
    mimeType: "text/plain",
    content: "x",
  };
  expect(
    promptAttachmentsSchema.safeParse(Array(11).fill(inline)).success,
  ).toBe(false);
  expect(
    promptAttachmentsSchema.safeParse([...refs, ...Array(11).fill(inline)])
      .success,
  ).toBe(false);
});
