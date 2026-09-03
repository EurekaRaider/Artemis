import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

async function assetMetrics(directory) {
  let cssBytes = 0;
  let jsBytes = 0;
  let largestJsBytes = 0;
  const visit = async (path) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      const bytes = (await stat(child)).size;
      if (extname(entry.name) === ".css") cssBytes += bytes;
      if (extname(entry.name) === ".js") {
        jsBytes += bytes;
        largestJsBytes = Math.max(largestJsBytes, bytes);
      }
    }
  };
  await visit(directory);
  return { cssBytes, jsBytes, largestJsBytes };
}

function assertBudget(name, actual, maximum, violations) {
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(maximum) ||
    actual > maximum
  ) {
    violations.push(`${name}: ${String(actual)} exceeds ${String(maximum)}`);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

export async function verifyUiPerformance(
  root = defaultRoot,
  screenshotManifestPath,
) {
  const budget = JSON.parse(
    await readFile(join(root, "scripts/ui-performance-budget.json"), "utf8"),
  );
  const desktop = await assetMetrics(join(root, "apps/desktop/dist-renderer"));
  const gallery = await assetMetrics(join(root, "apps/ui-gallery/dist"));
  const uiCssBytes = (await stat(join(root, "packages/ui/dist/styles.css")))
    .size;
  const metrics = {
    desktopCssBytes: desktop.cssBytes,
    desktopJsBytes: desktop.jsBytes,
    desktopLargestJsBytes: desktop.largestJsBytes,
    galleryCssBytes: gallery.cssBytes,
    galleryJsBytes: gallery.jsBytes,
    uiCssBytes,
  };
  const violations = [];
  for (const [name, maximum] of Object.entries(budget.thresholds.bundles)) {
    assertBudget(name, metrics[name], maximum, violations);
  }

  let startupStageMaximumMs;
  if (screenshotManifestPath !== undefined) {
    const manifest = JSON.parse(await readFile(screenshotManifestPath, "utf8"));
    startupStageMaximumMs = {};
    for (const variant of manifest.variants ?? []) {
      for (const timing of variant.startupTimings ?? []) {
        startupStageMaximumMs[timing.stage] = Math.max(
          startupStageMaximumMs[timing.stage] ?? 0,
          timing.elapsedMs,
        );
      }
    }
    for (const [stage, maximum] of Object.entries(
      budget.thresholds.startupStageMaximumMs,
    )) {
      assertBudget(
        `startup.${stage}`,
        startupStageMaximumMs[stage],
        maximum,
        violations,
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `UI performance verification failed:\n${violations.join("\n")}`,
    );
  }
  return {
    baseline: budget.baseline,
    metrics,
    startupStageMaximumMs,
    thresholds: budget.thresholds,
  };
}

async function main() {
  const root = resolve(argument("--root") ?? defaultRoot);
  const screenshotManifest = argument("--screenshot-manifest");
  const report = await verifyUiPerformance(
    root,
    screenshotManifest === undefined ? undefined : resolve(screenshotManifest),
  );
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
