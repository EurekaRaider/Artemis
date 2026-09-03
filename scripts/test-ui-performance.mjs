import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(
  new URL("./verify-ui-performance.mjs", import.meta.url),
);

async function fixture(maximum, startupElapsed = 100) {
  const root = await mkdtemp(join(tmpdir(), "artemis-ui-performance-"));
  const files = {
    "apps/desktop/dist-renderer/assets/app.js":
      "export const marker = 'desktop';\n",
    "apps/desktop/dist-renderer/assets/app.css": ".desktop{}\n",
    "apps/ui-gallery/dist/assets/gallery.js":
      "export const marker = 'gallery';\n",
    "apps/ui-gallery/dist/assets/gallery.css": ".gallery{}\n",
    "packages/ui/dist/styles.css": ".ui{}\n",
    "scripts/ui-performance-budget.json": `${JSON.stringify({ baseline: { startupStageMaximumMs: { "renderer-ready": 100 } }, thresholds: { bundles: { desktopCssBytes: maximum, desktopJsBytes: maximum, desktopLargestJsBytes: maximum, galleryCssBytes: maximum, galleryJsBytes: maximum, uiCssBytes: maximum }, startup: { baselineMultiplier: 4, jitterAllowanceMs: 500 } } })}\n`,
    "manifest.json": `${JSON.stringify({ variants: [{ startupTimings: [{ stage: "renderer-ready", elapsedMs: startupElapsed }] }] })}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

async function runCase(maximum, startupElapsed, expectedSuccess) {
  const root = await fixture(maximum, startupElapsed);
  try {
    const result = spawnSync(
      process.execPath,
      [
        checker,
        "--root",
        root,
        "--screenshot-manifest",
        join(root, "manifest.json"),
      ],
      { encoding: "utf8" },
    );
    if ((result.status === 0) !== expectedSuccess) {
      throw new Error(
        `performance fixture expected success=${String(expectedSuccess)}\n${result.stdout}${result.stderr}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runCase(1_000, 100, true);
await runCase(1, 100, false);
await runCase(1_000, 5_000, false);
console.log("UI performance budget fixtures passed (1 accepted; 2 rejected)");
