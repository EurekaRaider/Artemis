import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  readLocalTextFile,
  resolveLocalFilePath,
  writeLocalTextFile,
} from "../src/main/local-file-access.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("approved local file access", () => {
  it("requires an absolute path", () => {
    expect(() => resolveLocalFilePath("notes.txt")).toThrow("absolute");
  });

  it("reads and writes UTF-8 files with desktop-user permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-local-file-"));
    cleanupPaths.push(directory);
    const path = join(directory, "nested", "notes.txt");

    await expect(writeLocalTextFile(path, "first")).resolves.toEqual({
      operation: "create",
      path,
    });
    await expect(readLocalTextFile(path)).resolves.toBe("first");
    await expect(writeLocalTextFile(path, "second")).resolves.toEqual({
      operation: "update",
      path,
    });
    await expect(readFile(path, "utf8")).resolves.toBe("second");
  });
});
