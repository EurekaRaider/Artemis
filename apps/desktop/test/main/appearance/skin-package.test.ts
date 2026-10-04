import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artemisThemeManifest,
  artemisTokenDocuments,
} from "../../../../../packages/theme-artemis/src/index.js";
import {
  loadSkinPackage,
  validateSkinAsset,
} from "../../../src/main/appearance/skin-package.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
export async function writeTestSkin(root: string, id = "com.example.ocean") {
  await mkdir(root, { recursive: true });
  const manifest = {
    ...artemisThemeManifest,
    id,
    schemaVersion: 2,
    assets: {},
    backgrounds: { light: { type: "none" }, dark: { type: "none" } },
  };
  const data = {
    "manifest.json": manifest,
    ...Object.fromEntries(
      Object.entries(artemisTokenDocuments).map(([p, v]) => [
        p,
        { ...v, skinId: id },
      ]),
    ),
  };
  const files: Record<string, string> = {};
  for (const [p, value] of Object.entries(data)) {
    const bytes = JSON.stringify(value);
    await writeFile(join(root, p), bytes);
    files[p] = createHash("sha256").update(bytes).digest("hex");
  }
  await writeFile(
    join(root, "integrity.json"),
    JSON.stringify({ schemaVersion: 2, algorithm: "sha256", files }),
  );
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skin-test-"));
  roots.push(root);
  await writeTestSkin(root);
  return root;
}
describe("skin package filesystem boundary", () => {
  it("loads a complete package and refuses undeclared files", async () => {
    const root = await fixture();
    expect((await loadSkinPackage(root)).data.manifest.id).toBe(
      "com.example.ocean",
    );
    await writeFile(join(root, "extra.json"), "{}");
    await expect(loadSkinPackage(root)).rejects.toThrow(/undeclared/);
  });
  it("refuses token tampering and symlinks", async () => {
    const root = await fixture();
    await writeFile(join(root, "tokens.dark.json"), "{}");
    await expect(loadSkinPackage(root)).rejects.toThrow();
    await writeTestSkin(root);
    await rm(join(root, "tokens.dark.json"));
    await symlink(
      process.platform === "win32"
        ? await fixture()
        : join(root, "tokens.light.json"),
      join(root, "tokens.dark.json"),
      process.platform === "win32" ? "junction" : "file",
    );
    await expect(loadSkinPackage(root)).rejects.toThrow(/symlink/);
  });
  it("rejects mismatched signatures, corrupt video and font headers", () => {
    expect(() =>
      validateSkinAsset(
        Buffer.from("<script>bad</script>"),
        "assets/a.png",
        "image",
      ),
    ).toThrow();
    expect(() =>
      validateSkinAsset(Buffer.from("bad"), "assets/a.webm", "video"),
    ).toThrow();
    expect(() =>
      validateSkinAsset(Buffer.from("bad"), "assets/a.woff2", "font"),
    ).toThrow();
  });
  it("rejects excessive decoded image dimensions before decode", () => {
    const b = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
    b.write("IHDR", 12);
    b.writeUInt32BE(10000, 16);
    b.writeUInt32BE(10000, 20);
    expect(() => validateSkinAsset(b, "assets/a.png", "image")).toThrow(
      /pixel/,
    );
  });
});
