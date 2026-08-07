import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { preparePackagedNodePtyRuntime } from "../src/main/node-pty-runtime.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createNodePtyFixture() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "node-pty-source-"));
  cleanup.push(sourceRoot);
  const prebuildRoot = join(sourceRoot, "prebuilds", "darwin-arm64");
  await mkdir(join(sourceRoot, "lib", "shared"), { recursive: true });
  await mkdir(prebuildRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "package.json"),
    JSON.stringify({ name: "node-pty", main: "lib/index.js" }),
  );
  await writeFile(join(sourceRoot, "lib", "index.js"), "exports.spawn = 1;");
  await writeFile(join(sourceRoot, "lib", "shared", "utils.js"), "fixture");
  await writeFile(join(prebuildRoot, "pty.node"), "native-fixture");
  await writeFile(join(prebuildRoot, "spawn-helper"), "helper-fixture");
  await chmod(join(prebuildRoot, "spawn-helper"), 0o644);
  return sourceRoot;
}

describe("packaged node-pty runtime", () => {
  it("copies only the selected Darwin runtime into a private disposable root", async () => {
    const sourceRoot = await createNodePtyFixture();
    const runtime = await preparePackagedNodePtyRuntime(sourceRoot, "arm64");
    cleanup.push(runtime.moduleRoot);

    expect((await stat(runtime.moduleRoot)).mode & 0o777).toBe(0o700);
    expect(
      await readFile(join(runtime.moduleRoot, "lib", "index.js"), "utf8"),
    ).toBe("exports.spawn = 1;");
    expect(
      await readFile(
        join(runtime.moduleRoot, "prebuilds", "darwin-arm64", "pty.node"),
        "utf8",
      ),
    ).toBe("native-fixture");
    expect(
      (
        await stat(
          join(runtime.moduleRoot, "prebuilds", "darwin-arm64", "spawn-helper"),
        )
      ).mode & 0o777,
    ).toBe(0o755);
    await expect(
      lstat(join(runtime.moduleRoot, "prebuilds", "darwin-x64")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (
        await stat(
          join(sourceRoot, "prebuilds", "darwin-arm64", "spawn-helper"),
        )
      ).mode & 0o777,
    ).toBe(0o644);

    await runtime.dispose();
    await runtime.dispose();
    await expect(lstat(runtime.moduleRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects linked files instead of following them out of the package", async () => {
    const sourceRoot = await createNodePtyFixture();
    const linkedFile = join(sourceRoot, "lib", "shared", "linked.js");
    await mkdir(dirname(linkedFile), { recursive: true });
    await symlink(join(sourceRoot, "package.json"), linkedFile);

    await expect(
      preparePackagedNodePtyRuntime(sourceRoot, "arm64"),
    ).rejects.toThrow("cannot contain links");
  });
});
