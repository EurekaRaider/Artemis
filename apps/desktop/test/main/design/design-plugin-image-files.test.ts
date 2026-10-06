import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  readDesignImage,
  readProjectFileForPreview,
  scanProjectDesignFiles,
} from "../../../src/main/design/design-plugin-project-files.js";

const directories: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "design-images-"));
  directories.push(root);
  const images = join(root, "images");
  await mkdir(images);
  return { root, images };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("reads images exactly while rejecting escapes, non-images and oversized files", async () => {
  const { root, images } = await fixture();
  await writeFile(join(images, "a..b.png"), "inside");
  await writeFile(join(root, "outside.png"), "secret");
  await writeFile(join(images, "notes.txt"), "text");
  await writeFile(join(images, "large.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
  await symlink(join(root, "outside.png"), join(images, "escape.png"));
  expect(await readDesignImage(images, "image-dir:a..b.png")).toBe(
    "data:image/png;base64,aW5zaWRl",
  );
  for (const name of ["../outside.png", "escape.png", "notes.txt", "large.png"])
    expect(await readDesignImage(images, `image-view:${name}`)).toBeUndefined();
});
it("limits image scans after filtering HTML and skips links and build directories", async () => {
  const { root, images } = await fixture();
  await Promise.all(
    Array.from({ length: 120 }, (_, n) =>
      writeFile(join(images, `${n}.html`), "page"),
    ),
  );
  await writeFile(join(images, "z.png"), "image");
  await mkdir(join(images, "dist"));
  await writeFile(join(images, "dist", "hidden.png"), "hidden");
  await writeFile(join(root, "outside.png"), "secret");
  await symlink(join(root, "outside.png"), join(images, "link.png"));
  expect(
    (await scanProjectDesignFiles(images, true)).map((file) => file.path),
  ).toEqual(["z.png"]);
  expect(await scanProjectDesignFiles(images)).toHaveLength(120);
});

it("opens automatically scanned project images as bounded image previews", async () => {
  const { images } = await fixture();
  await writeFile(join(images, "photo.png"), "image");
  const preview = await readProjectFileForPreview({
    workspacePath: images,
    requestedPath: "photo.png",
  });
  expect(preview.content).toContain('src="data:image/png;base64,aW1hZ2U="');
});
