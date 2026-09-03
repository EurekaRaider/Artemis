import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(
  new URL("./verify-ui-performance.mjs", import.meta.url),
);

function startupVariant(id, appReady, coreStateReady, rendererReady) {
  return {
    id,
    startupTimings: [
      { stage: "app-ready", elapsedMs: appReady },
      { stage: "core-state-ready", elapsedMs: coreStateReady },
      { stage: "renderer-ready", elapsedMs: rendererReady },
    ],
  };
}

async function fixture(
  maximum,
  startupVariants = [startupVariant("normal", 100, 200, 300)],
) {
  const root = await mkdtemp(join(tmpdir(), "artemis-ui-performance-"));
  const files = {
    "apps/desktop/dist-renderer/assets/app.js":
      "export const marker = 'desktop';\n",
    "apps/desktop/dist-renderer/assets/app.css": ".desktop{}\n",
    "apps/ui-gallery/dist/assets/gallery.js":
      "export const marker = 'gallery';\n",
    "apps/ui-gallery/dist/assets/gallery.css": ".gallery{}\n",
    "packages/ui/dist/styles.css": ".ui{}\n",
    "scripts/ui-performance-budget.json": `${JSON.stringify({ baseline: { startupStageMaximumMs: { "app-ready": 10, "core-state-ready": 105.7, "renderer-ready": 320.7 } }, thresholds: { bundles: { desktopCssBytes: maximum, desktopJsBytes: maximum, desktopLargestJsBytes: maximum, galleryCssBytes: maximum, galleryJsBytes: maximum, uiCssBytes: maximum }, startup: { baselineMultiplier: 8, jitterAllowanceMs: 500, maximumWarmOutlierVariants: 2, warmHardMaximumMs: 4_000, coldStartHardMaximumMs: 10_000 } } })}\n`,
    "manifest.json": `${JSON.stringify({ variants: startupVariants })}\n`,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content, "utf8");
  }
  return root;
}

async function runCase(maximum, startupVariants, expectedSuccess) {
  const root = await fixture(maximum, startupVariants);
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

const normalVariants = Array.from({ length: 27 }, (_, index) =>
  startupVariant(`normal-${String(index + 1)}`, 100, 200, 300),
);
await runCase(1_000, normalVariants, true);
await runCase(1, normalVariants, false);
await runCase(1_000, [], false);
await runCase(
  1_000,
  [
    normalVariants[0],
    startupVariant("five-second-warm-regression", 100, 200, 5_000),
    ...normalVariants.slice(2),
  ],
  false,
);
await runCase(
  1_000,
  [
    startupVariant("windows-cold-start", 100, 6_809.7, 7_267.3),
    startupVariant("windows-warm-outlier-1", 100, 200, 3_324.4),
    startupVariant("windows-warm-outlier-2", 100, 200, 3_108.8),
    ...normalVariants.slice(3),
  ],
  true,
);
await runCase(
  1_000,
  [
    startupVariant("cold-start-regression", 100, 9_000, 10_000.1),
    ...normalVariants.slice(1),
  ],
  false,
);
await runCase(
  1_000,
  [
    normalVariants[0],
    startupVariant("warm-outlier-1", 100, 2_211.4, 3_500),
    startupVariant("warm-outlier-2", 100, 2_211.4, 3_500),
    startupVariant("warm-outlier-3", 100, 2_211.4, 3_500),
    ...normalVariants.slice(4),
  ],
  false,
);
console.log("UI performance budget fixtures passed (2 accepted; 5 rejected)");
