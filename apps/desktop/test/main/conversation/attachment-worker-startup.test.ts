import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("parses, reads and searches text without loading image or Office decoders", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-text-worker-startup-"));
  try {
    const path = join(root, "original");
    const output = join(root, "text.sqlite");
    await writeFile(path, "persisted text needle");
    const worker = new URL(
      "../../../src/main/conversation/attachment-worker.ts",
      import.meta.url,
    ).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from "node:assert/strict";
        import { registerHooks } from "node:module";
        registerHooks({ resolve(specifier, context, next) {
          if (specifier === "@napi-rs/canvas" || specifier.includes("attachment-office-index"))
            throw new Error("Unneeded decoder loaded by text worker: " + specifier);
          return next(specifier, context);
        }});
        const { processAttachment } = await import(${JSON.stringify(worker)});
        const input = ${JSON.stringify({ path, output, mimeType: "text/plain" })};
        const parsed = await processAttachment({ ...input, action: "parse" });
        assert.equal(parsed.characters, 21);
        const read = await processAttachment({ ...input, path: input.output, action: "read" });
        assert.equal(read.text, "persisted text needle");
        const search = await processAttachment({ ...input, path: input.output, action: "search", query: "needle" });
        assert.equal(search.matches[0].offset, 15);`,
      ],
      { encoding: "utf8", timeout: 4000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
