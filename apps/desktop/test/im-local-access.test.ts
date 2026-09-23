import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  buildLocalImShellLaunch,
  readLocalImFile,
  writeLocalImFile,
} from "../src/main/im-local-access.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("preserves concurrent-edit checks and authorizes before changing file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "im-local-file-"));
  roots.push(root);
  const path = join(root, "file.txt");
  await writeFile(path, "before");
  const read = await readLocalImFile(root, "file.txt");
  if (!("contentHash" in read)) throw new Error("Expected file result");
  await writeFile(path, "concurrent edit");
  await expect(
    writeLocalImFile(root, path, "wrong", () => {}, read.contentHash),
  ).rejects.toThrow(/changed/);
  await expect(
    writeLocalImFile(root, path, "wrong", () => {}, "absent"),
  ).rejects.toThrow();
  await expect(
    writeLocalImFile(root, path, "wrong", () => {
      throw new Error("revoked");
    }),
  ).rejects.toThrow("revoked");
  expect(await readFile(path, "utf8")).toBe("concurrent edit");
  await writeLocalImFile(root, "created.txt", "new", () => {}, "absent");
  expect(await readFile(join(root, "created.txt"), "utf8")).toBe("new");
});
it("launches without elevation as the desktop user", () => {
  const launch = buildLocalImShellLaunch("/workspace", "echo ok");
  expect(launch.implementation).toBe("desktop-user");
  expect(launch.cwd).toBe("/workspace");
  expect(launch.args.at(-1)).toBe("echo ok");
  expect(launch.executable).not.toMatch(/sudo|runas/);
});
