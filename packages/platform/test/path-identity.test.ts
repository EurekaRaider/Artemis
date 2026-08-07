import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalizeFileSystemPath,
  sameFileSystemPath,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("filesystem path identity", () => {
  it("treats a symlink alias and its canonical target as the same path", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-path-identity-"));
    temporaryDirectories.push(root);
    const target = join(root, "target");
    const alias = join(root, "alias");
    await mkdir(target);
    await symlink(target, alias, "junction");

    expect(sameFileSystemPath(alias, target)).toBe(true);
    expect(canonicalizeFileSystemPath(join(alias, "new.txt"))).toBe(
      join(await realpath(target), "new.txt"),
    );
  });
});
