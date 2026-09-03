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

export function startupStageMaximums(budget) {
  const baseline = budget.baseline?.startupStageMaximumMs;
  const policy = budget.thresholds?.startup;
  const multiplier = policy?.baselineMultiplier;
  const jitter = policy?.jitterAllowanceMs;
  const maximumWarmOutlierVariants = policy?.maximumWarmOutlierVariants;
  const warmHardMaximumMs = policy?.warmHardMaximumMs;
  const coldStartHardMaximumMs = policy?.coldStartHardMaximumMs;
  if (
    baseline === undefined ||
    typeof baseline !== "object" ||
    !Number.isFinite(multiplier) ||
    multiplier < 1 ||
    !Number.isFinite(jitter) ||
    jitter < 0 ||
    !Number.isInteger(maximumWarmOutlierVariants) ||
    maximumWarmOutlierVariants < 0 ||
    !Number.isFinite(warmHardMaximumMs) ||
    warmHardMaximumMs <= 0 ||
    !Number.isFinite(coldStartHardMaximumMs) ||
    coldStartHardMaximumMs < warmHardMaximumMs
  ) {
    throw new Error(
      "UI performance startup budget requires a baseline, multiplier >= 1, non-negative jitter allowance, non-negative integer warm-outlier allowance, a positive warm hard maximum, and a cold hard maximum no lower than the warm maximum",
    );
  }
  const baselineStages = Object.entries(baseline);
  if (baselineStages.length === 0) {
    throw new Error(
      "UI performance startup baseline requires at least one stage",
    );
  }
  const thresholds = Object.fromEntries(
    baselineStages.map(([stage, value]) => {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid startup baseline for ${stage}`);
      }
      return [stage, Math.round((value * multiplier + jitter) * 10) / 10];
    }),
  );
  if (warmHardMaximumMs < Math.max(...Object.values(thresholds))) {
    throw new Error(
      "UI performance warm hard maximum must cover every derived stage ceiling",
    );
  }
  return thresholds;
}

export function evaluateStartupTimings(budget, variants) {
  const thresholds = startupStageMaximums(budget);
  const policy = budget.thresholds.startup;
  const maximumWarmOutlierVariants = policy.maximumWarmOutlierVariants;
  const warmHardMaximumMs = policy.warmHardMaximumMs;
  const coldStartHardMaximumMs = policy.coldStartHardMaximumMs;
  const stageMaximumMs = {};
  const warmStageMaximumMs = {};
  const warmOutlierVariants = [];
  const violations = [];

  if (variants.length === 0) {
    violations.push("startup matrix: expected at least one variant");
  }

  for (const [index, variant] of variants.entries()) {
    const variantId = variant.id ?? `variant-${String(index + 1)}`;
    const isColdStart = index === 0;
    const hardMaximumMs = isColdStart
      ? coldStartHardMaximumMs
      : warmHardMaximumMs;
    const stageOutliers = [];
    for (const [stage, maximum] of Object.entries(thresholds)) {
      const matches = (variant.startupTimings ?? []).filter(
        (timing) => timing.stage === stage,
      );
      if (matches.length !== 1 || !Number.isFinite(matches[0]?.elapsedMs)) {
        violations.push(
          `startup.${variantId}.${stage}: expected one finite timing`,
        );
        continue;
      }
      const actual = matches[0].elapsedMs;
      stageMaximumMs[stage] = Math.max(stageMaximumMs[stage] ?? 0, actual);
      if (!isColdStart) {
        warmStageMaximumMs[stage] = Math.max(
          warmStageMaximumMs[stage] ?? 0,
          actual,
        );
      }
      if (!isColdStart && actual > maximum) {
        stageOutliers.push({ stage, actual, maximum });
      }
      if (actual > hardMaximumMs) {
        violations.push(
          `startup.${variantId}.${stage}: ${String(actual)} exceeds ${isColdStart ? "cold" : "warm"} hard maximum ${String(hardMaximumMs)}`,
        );
      }
    }
    if (stageOutliers.length > 0) {
      warmOutlierVariants.push({ id: variantId, stages: stageOutliers });
    }
  }

  if (warmOutlierVariants.length > maximumWarmOutlierVariants) {
    violations.push(
      `startup warm outlier variants: ${String(warmOutlierVariants.length)} exceeds ${String(maximumWarmOutlierVariants)} (${warmOutlierVariants.map((variant) => variant.id).join(", ")})`,
    );
  }

  return {
    coldStartVariantId:
      variants.length === 0 ? null : (variants[0]?.id ?? "variant-1"),
    stageMaximumMs,
    warmStageMaximumMs,
    thresholds,
    warmHardMaximumMs,
    coldStartHardMaximumMs,
    maximumWarmOutlierVariants,
    warmOutlierVariants,
    violations,
  };
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

  const startupThresholds = startupStageMaximums(budget);
  let startupColdStartVariantId;
  let startupStageMaximumMs;
  let startupWarmStageMaximumMs;
  let startupWarmOutlierVariants;
  if (screenshotManifestPath !== undefined) {
    const manifest = JSON.parse(await readFile(screenshotManifestPath, "utf8"));
    const startup = evaluateStartupTimings(budget, manifest.variants ?? []);
    startupColdStartVariantId = startup.coldStartVariantId;
    startupStageMaximumMs = startup.stageMaximumMs;
    startupWarmStageMaximumMs = startup.warmStageMaximumMs;
    startupWarmOutlierVariants = startup.warmOutlierVariants;
    violations.push(...startup.violations);
  }
  if (violations.length > 0) {
    throw new Error(
      `UI performance verification failed:\n${violations.join("\n")}`,
    );
  }
  return {
    baseline: budget.baseline,
    metrics,
    startupColdStartVariantId,
    startupStageMaximumMs,
    startupWarmStageMaximumMs,
    startupWarmOutlierVariants,
    thresholds: {
      ...budget.thresholds,
      startupStageMaximumMs: startupThresholds,
    },
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
