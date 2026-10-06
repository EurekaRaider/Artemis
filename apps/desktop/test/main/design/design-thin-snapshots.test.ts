import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  designThinSnapshotDir,
  listDesignThinVersions,
  recordDesignThinSnapshot,
  redoDesignThinVersion,
  restoreDesignThinVersion,
  undoDesignThinVersion,
  writeDesignWorkspacePage,
  writeWorkspaceFileChecked,
} from "../../../src/main/design/design-thin-snapshots.js";

let root: string;
let workspace: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "design-thin-"));
  workspace = join(root, "workspace");
  await mkdir(workspace);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("preserves the first state, supports repeated undo and redo, and ends redo after a new edit", async () => {
  await writeFile(join(workspace, "page.html"), "original");
  await writeDesignWorkspacePage(workspace, "page.html", "second");
  await writeDesignWorkspacePage(workspace, "page.html", "third");
  expect(await undoDesignThinVersion(workspace, "page.html")).toMatchObject({
    content: "second",
  });
  expect(await readFile(join(workspace, "page.html"), "utf8")).toBe("second");
  expect(await undoDesignThinVersion(workspace, "page.html")).toMatchObject({
    content: "original",
  });
  expect(await redoDesignThinVersion(workspace, "page.html")).toMatchObject({
    content: "second",
  });
  await writeDesignWorkspacePage(workspace, "page.html", "fourth");
  expect(await redoDesignThinVersion(workspace, "page.html")).toHaveProperty(
    "error",
  );
  expect(await listDesignThinVersions(workspace, "page.html")).toHaveLength(5);
});

it("records external edits before undo and panel restore overwrite them", async () => {
  await writeDesignWorkspacePage(workspace, "page.html", "original");
  await writeDesignWorkspacePage(workspace, "page.html", "second");
  const original = (await listDesignThinVersions(workspace, "page.html"))[0]!;
  await writeFile(join(workspace, "page.html"), "external");
  expect(await undoDesignThinVersion(workspace, "page.html")).toMatchObject({
    content: "second",
  });
  expect(await redoDesignThinVersion(workspace, "page.html")).toMatchObject({
    content: "external",
  });
  await writeFile(join(workspace, "page.html"), "external before restore");
  expect(
    await restoreDesignThinVersion(workspace, "page.html", original.file),
  ).toBe("original");
  const versions = await listDesignThinVersions(workspace, "page.html");
  expect(versions).toHaveLength(5);
  expect(
    await readFile(
      join(designThinSnapshotDir(workspace, "page.html")!, versions[3]!.file),
      "utf8",
    ),
  ).toBe("external before restore");
});

it("rejects empty and ambiguous edits without replacing the file, and treats replacement dollars literally", async () => {
  await writeDesignWorkspacePage(workspace, "page.html", "one two one");
  await expect(
    writeDesignWorkspacePage(workspace, "page.html", "oops", ""),
  ).rejects.toThrow();
  await expect(
    writeDesignWorkspacePage(workspace, "page.html", "oops", "one"),
  ).rejects.toThrow();
  expect(await readFile(join(workspace, "page.html"), "utf8")).toBe(
    "one two one",
  );
  await writeDesignWorkspacePage(workspace, "page.html", "$& $` $'", "two");
  expect(await readFile(join(workspace, "page.html"), "utf8")).toBe(
    "one $& $` $' one",
  );
});

it("serializes edits on one file and retains both changes", async () => {
  await writeDesignWorkspacePage(workspace, "page.html", "left right");
  await Promise.all([
    writeDesignWorkspacePage(workspace, "page.html", "LEFT", "left"),
    writeDesignWorkspacePage(workspace, "page.html", "RIGHT", "right"),
  ]);
  expect(await readFile(join(workspace, "page.html"), "utf8")).toBe(
    "LEFT RIGHT",
  );
  expect(await listDesignThinVersions(workspace, "page.html")).toHaveLength(3);
});

it("uses unique snapshot names even when timestamps and restored content repeat", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_790_000_000_000);
  await writeDesignWorkspacePage(workspace, "page.html", "a");
  await writeDesignWorkspacePage(workspace, "page.html", "b");
  await writeDesignWorkspacePage(workspace, "page.html", "a");
  const versions = await listDesignThinVersions(workspace, "page.html");
  expect(versions).toHaveLength(3);
  expect(new Set(versions.map((version) => version.file)).size).toBe(3);
});

it("denies file, parent-directory and snapshot-store symlink escapes", async () => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.html"), "private");
  await symlink(outside, join(workspace, "linked"), "junction");
  await symlink(join(outside, "secret.html"), join(workspace, "linked.html"));
  for (const path of ["linked/secret.html", "linked.html"]) {
    await expect(recordDesignThinSnapshot(workspace, path)).rejects.toThrow();
    await expect(
      writeWorkspaceFileChecked(workspace, path, "corrupt"),
    ).rejects.toThrow();
  }
  await symlink(outside, join(workspace, ".artemis"), "junction");
  await writeFile(join(workspace, "safe.html"), "safe");
  await expect(
    recordDesignThinSnapshot(workspace, "safe.html"),
  ).rejects.toThrow();
  expect(await readFile(join(outside, "secret.html"), "utf8")).toBe("private");
});

it("caps retained snapshots and checks authorization before any write", async () => {
  for (let n = 0; n < 55; n++)
    await writeDesignWorkspacePage(workspace, "page.html", String(n));
  expect(await listDesignThinVersions(workspace, "page.html")).toHaveLength(50);
  await expect(
    writeDesignWorkspacePage(
      workspace,
      "page.html",
      "blocked",
      undefined,
      () => {
        throw new Error("Plan denied");
      },
    ),
  ).rejects.toThrow("Plan denied");
  expect(await readFile(join(workspace, "page.html"), "utf8")).toBe("54");
});
