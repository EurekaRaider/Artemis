import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  link,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  WindowsImFiles,
  runWindowsImShell,
  imSnapshotChanges,
} from "../src/main/im-windows-files.js";

describe("Windows IM snapshot writeback policy", () => {
  const scope = {
    audience: "owner",
    readPaths: ["src", "docs"],
    writePaths: ["src"],
  };
  const file = (path: string, content: string) => ({
    path,
    directory: false,
    data: Buffer.from(content).toString("base64"),
  });
  it("binds edits and deletions to the original bytes and new files to absence", () => {
    const before = [
      file("src/edit.txt", "old"),
      file("src/deleted.txt", "remove"),
      file("docs/guide.txt", "read only"),
    ];
    const after = [
      file("src/edit.txt", "new"),
      file("src/new.txt", "created"),
      file("docs/guide.txt", "read only"),
    ];
    const changes = imSnapshotChanges(before, after, scope);
    expect(changes).toHaveLength(3);
    expect(changes[0]?.expected).toMatch(/^[a-f0-9]{64}$/);
    expect(changes[1]?.expected).toBe("absent");
    expect(changes[2]?.delete).toBe(true);
  });
  it("rejects readonly changes, protected paths and type changes before any writeback", () => {
    for (const path of [
      "docs/guide.txt",
      "src/.env",
      "src/AGENTS.md",
      "../private.txt",
    ])
      expect(() => imSnapshotChanges([], [file(path, "bad")], scope)).toThrow();
    expect(() =>
      imSnapshotChanges(
        [file("src/file", "old")],
        [{ path: "src/file", directory: true }],
        scope,
      ),
    ).toThrow(/type/);
  });
});

const helper = fileURLToPath(
  new URL("../resources/windows-sandbox.ps1", import.meta.url),
);
describe.runIf(process.platform === "win32")(
  "Windows IM native file and shell boundary",
  () => {
    // Keep native scenarios separate: every request starts PowerShell and
    // compiles the broker, with a 60-second operation limit of its own.
    it("creates, edits, reads and lists files within the grant", async () => {
      const root = await mkdtemp(join(tmpdir(), "artemis-im-files-"));
      const scope = {
        audience: "owner",
        readPaths: ["src"],
        writePaths: ["src"],
      };
      const files = new WindowsImFiles(helper);
      try {
        await mkdir(join(root, "src"));
        await mkdir(join(root, "private"));
        await writeFile(join(root, "private", "secret.txt"), "PRIVATE");
        await writeFile(join(root, "src", ".env"), "PROTECTED");
        await files.write(root, "src/new.txt", "CREATED", scope, () => {});
        expect(await readFile(join(root, "src", "new.txt"), "utf8")).toBe(
          "CREATED",
        );
        await files.write(root, "src/new.txt", "EDITED", scope, () => {});
        expect((await files.read(root, "src/new.txt", scope)).toString()).toBe(
          "EDITED",
        );
        expect(await files.list(root, "src", scope)).toEqual([
          { path: "src/new.txt", directory: false },
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 120000);

    it("rejects junctions, hard links and secrets without modifying private data", async () => {
      const root = await mkdtemp(join(tmpdir(), "artemis-im-files-denied-"));
      const scope = {
        audience: "owner",
        readPaths: ["src"],
        writePaths: ["src"],
      };
      const files = new WindowsImFiles(helper);
      try {
        await mkdir(join(root, "src"));
        await mkdir(join(root, "private"));
        await writeFile(join(root, "private", "secret.txt"), "PRIVATE");
        await writeFile(join(root, "src", ".env"), "PROTECTED");
        await symlink(
          join(root, "private"),
          join(root, "src", "junction"),
          "junction",
        );
        await link(
          join(root, "private", "secret.txt"),
          join(root, "src", "hard.txt"),
        );
        for (const path of [
          "src/junction/secret.txt",
          "src/hard.txt",
          "src/.env",
          "../private/secret.txt",
        ]) {
          await expect(files.read(root, path, scope)).rejects.toThrow(
            /reparse|hard links|protected|path|grant|project-relative|受保护|路径|范围/i,
          );
          await expect(
            files.write(root, path, "BAD", scope, () => {}),
          ).rejects.toThrow(
            /reparse|hard links|protected|path|grant|project-relative|受保护|路径|范围/i,
          );
        }
        expect(
          await readFile(join(root, "private", "secret.txt"), "utf8"),
        ).toBe("PRIVATE");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 120000);

    it("rechecks authorization before committing a native write", async () => {
      const root = await mkdtemp(join(tmpdir(), "artemis-im-files-revoked-"));
      const scope = {
        audience: "owner",
        readPaths: ["src"],
        writePaths: ["src"],
      };
      const files = new WindowsImFiles(helper);
      try {
        await mkdir(join(root, "src"));
        let authorizationChecks = 0;
        await expect(
          files.write(root, "src/revoked.txt", "BAD", scope, () => {
            if (++authorizationChecks > 2) throw new Error("revoked");
          }),
        ).rejects.toThrow(/revoked/);
        await expect(
          readFile(join(root, "src", "revoked.txt")),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 60000);

    it("executes PowerShell on authorized data and applies only scoped changes", async () => {
      const root = await mkdtemp(join(tmpdir(), "artemis-im-shell-"));
      try {
        await mkdir(join(root, "src"));
        await mkdir(join(root, "docs"));
        await writeFile(join(root, "src", ".env"), "PROTECTED_SENTINEL");
        await writeFile(join(root, "private.txt"), "PRIVATE_SENTINEL");
        await writeFile(join(root, "docs", "guide.txt"), "READABLE");
        const result = await runWindowsImShell({
          workspace: root,
          helper,
          scope: {
            audience: "owner",
            readPaths: ["src", "docs"],
            writePaths: ["src"],
          },
          command: `Get-Content docs/guide.txt; Set-Content docs/guide.txt 'FORBIDDEN' -ErrorAction SilentlyContinue; Set-Content src/new.txt 'UPDATED'; Get-ChildItem src; Get-Content src/.env -ErrorAction SilentlyContinue; Get-Content '${join(root, "private.txt").replaceAll("'", "''")}' -ErrorAction SilentlyContinue; Write-Output 'FINISHED'`,
          network: false,
          signal: new AbortController().signal,
          timeoutSeconds: 30,
          assertCurrent: () => {},
        });
        expect(result.output).toContain("READABLE");
        expect(result.output).toContain("FINISHED");
        expect(result.output).not.toMatch(
          /PROTECTED_SENTINEL|PRIVATE_SENTINEL/,
        );
        expect(await readFile(join(root, "src", "new.txt"), "utf8")).toContain(
          "UPDATED",
        );
        expect(await readFile(join(root, "src", ".env"), "utf8")).toBe(
          "PROTECTED_SENTINEL",
        );
        expect(await readFile(join(root, "docs", "guide.txt"), "utf8")).toBe(
          "READABLE",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 90000);
    it("refuses stale writeback before modifying any original file", async () => {
      const root = await mkdtemp(join(tmpdir(), "artemis-im-conflict-"));
      const files = new WindowsImFiles(helper);
      const scope = {
        audience: "owner",
        readPaths: ["src"],
        writePaths: ["src"],
      };
      try {
        await mkdir(join(root, "src"));
        await writeFile(join(root, "src", "one.txt"), "original one");
        await writeFile(join(root, "src", "two.txt"), "original two");
        const before = await files.snapshot(root, scope, () => {});
        const after = before.map((entry) =>
          entry.directory
            ? entry
            : { ...entry, data: Buffer.from("shell edit").toString("base64") },
        );
        await writeFile(join(root, "src", "two.txt"), "concurrent edit");
        await expect(
          files.apply(
            root,
            scope,
            imSnapshotChanges(before, after, scope),
            () => {},
          ),
        ).rejects.toThrow(/changed/);
        expect(await readFile(join(root, "src", "one.txt"), "utf8")).toBe(
          "original one",
        );
        expect(await readFile(join(root, "src", "two.txt"), "utf8")).toBe(
          "concurrent edit",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 60000);
  },
);
