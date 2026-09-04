import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);
const appDirectory = resolve(scriptDirectory, "..");
const workerPath = join(scriptDirectory, "verify-goal-parity.mjs");
const shardCount = 3;
// Leave headroom inside the aggregate verifier's unchanged 600-second budget
// for the sequential native-focus probe and manifest assembly.
const shardTimeoutMs = 520_000;
const focusProbeTimeoutMs = 60_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function runConcurrentShards(count, runShard) {
  assert(Number.isInteger(count) && count > 0, "Shard count must be positive.");
  return Promise.all(
    Array.from({ length: count }, (_, shardIndex) => runShard(shardIndex)),
  );
}

export async function runShardsThenExclusiveFocusProbe(
  count,
  runShard,
  runFocusProbe,
) {
  const shardOutcomes = await runConcurrentShards(count, runShard);
  const focusProbeOutcome = await runFocusProbe();
  return { shardOutcomes, focusProbeOutcome };
}

export function mergeGoalParityShardManifests(manifests, focusProbeManifest) {
  assert(manifests.length > 0, "No Goal parity shard manifests were found.");
  const expectedShardCount = manifests.length;
  const candidateHead = manifests[0].candidateHead;
  const launchMode = manifests[0].launchMode;
  const totalCaseCount = manifests[0].totalCaseCount;
  const shardIndexes = new Set();
  const results = [];

  assert(
    /^[0-9a-f]{40}$/u.test(candidateHead),
    "The Goal parity candidate HEAD is invalid.",
  );
  assert(
    Number.isInteger(totalCaseCount) && totalCaseCount > 0,
    "The Goal parity total case count is invalid.",
  );

  for (const manifest of manifests) {
    assert(
      manifest.format === "artemis-goal-parity-shard" && manifest.version === 1,
      "A Goal parity shard manifest has an unsupported format.",
    );
    assert(
      manifest.candidateHead === candidateHead,
      "Goal parity shard candidate HEADs differ.",
    );
    assert(
      manifest.launchMode === launchMode,
      "Goal parity shard launch modes differ.",
    );
    assert(
      manifest.totalCaseCount === totalCaseCount,
      "Goal parity shard total case counts differ.",
    );
    assert(
      manifest.shard?.count === expectedShardCount &&
        Number.isInteger(manifest.shard?.index) &&
        manifest.shard.index >= 0 &&
        manifest.shard.index < expectedShardCount,
      "A Goal parity shard identity is invalid.",
    );
    assert(
      !shardIndexes.has(manifest.shard.index),
      "Goal parity shard indexes are duplicated.",
    );
    shardIndexes.add(manifest.shard.index);
    assert(
      Array.isArray(manifest.results) &&
        manifest.caseCount === manifest.results.length,
      "A Goal parity shard result count is invalid.",
    );
    results.push(...manifest.results);
  }

  results.sort((left, right) => left.caseIndex - right.caseIndex);
  const caseIndexes = results.map((result) => result.caseIndex);
  const expectedCaseIndexes = Array.from(
    { length: totalCaseCount },
    (_, index) => index,
  );
  assert(
    JSON.stringify(caseIndexes) === JSON.stringify(expectedCaseIndexes),
    "Goal parity shards contain duplicate or missing case indexes.",
  );
  assert(
    new Set(results.map((result) => result.id)).size === totalCaseCount,
    "Goal parity shards contain duplicate case identifiers.",
  );
  assert(
    results.every((result) => result.sharedComponents?.focus === null),
    "Concurrent Goal parity shards must not request OS focus.",
  );

  assert(
    focusProbeManifest?.format === "artemis-goal-parity-focus-probe" &&
      focusProbeManifest.version === 1,
    "The Goal parity focus probe has an unsupported format.",
  );
  assert(
    focusProbeManifest.candidateHead === candidateHead &&
      focusProbeManifest.launchMode === launchMode &&
      focusProbeManifest.totalCaseCount === totalCaseCount,
    "The Goal parity focus probe does not match the shard evidence.",
  );
  assert(
    focusProbeManifest.focusProbe?.exclusive === true &&
      focusProbeManifest.focusProbe.caseIndex === 0 &&
      focusProbeManifest.caseCount === 1 &&
      focusProbeManifest.results?.length === 1,
    "The Goal parity focus probe identity is invalid.",
  );
  const focusResult = focusProbeManifest.results[0];
  const focus = focusResult.sharedComponents?.focus;
  const quietStyle = focusResult.sharedComponents?.contractStyles?.quiet;
  assert(
    focusResult.caseIndex === 0 &&
      focusResult.id === results[0].id &&
      focusResult.candidateHead === candidateHead &&
      focusResult.launchMode === launchMode &&
      focusResult.userDataIsolation?.freshStart === true &&
      focusResult.userDataIsolation.runRootUnexpectedEntries?.length === 0,
    "The Goal parity focus probe result is invalid.",
  );
  assert(
    focus?.active === true &&
      focus.outlineColor === quietStyle?.focusOutlineColor &&
      focus.outlineStyle === quietStyle?.focusOutlineStyle &&
      focus.outlineWidth === quietStyle?.focusOutlineWidth &&
      focus.outlineStyle === "solid" &&
      focus.outlineWidth === "2px",
    "The exclusive Goal parity focus contract drifted.",
  );

  return {
    format: "artemis-goal-parity",
    version: 5,
    candidateHead,
    launchMode,
    caseCount: totalCaseCount,
    execution: {
      strategy: "bounded-shards-with-exclusive-focus-probe",
      shardCount: expectedShardCount,
      exclusiveFocusProbe: true,
    },
    userDataIsolation: {
      directory: "user-data/<id> under each shard's throwaway run root",
      note: "Three bounded workers cover disjoint cases without competing for OS focus. After they exit, one exclusive focus probe uses its own fresh user-data directory. Every case records freshStart plus its run-root purity check. There is no --no-sandbox retry path.",
    },
    focusProbe: {
      ...focusResult,
      execution: "exclusive-post-shard",
      screenshot: `focus-probe/${focusResult.screenshot}`,
    },
    results,
  };
}

function executeWorker(outputDirectory, environment, identity, timeout) {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [workerPath, outputDirectory],
      {
        cwd: appDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          ...environment,
        },
        maxBuffer: 16 * 1024 * 1024,
        timeout,
      },
      (error, stdout, stderr) => {
        resolvePromise({
          ...identity,
          error,
          status:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : null,
          stdout,
          stderr,
        });
      },
    );
  });
}

function executeShard(shardIndex, outputDirectory) {
  return executeWorker(
    outputDirectory,
    {
      ARTEMIS_GOAL_PARITY_SHARD_COUNT: String(shardCount),
      ARTEMIS_GOAL_PARITY_SHARD_INDEX: String(shardIndex),
      ARTEMIS_GOAL_PARITY_EXCLUSIVE_FOCUS_PROBE: "0",
    },
    { phase: "shard", shardIndex },
    shardTimeoutMs,
  );
}

function executeFocusProbe(outputDirectory) {
  return executeWorker(
    join(outputDirectory, "focus-probe"),
    {
      ARTEMIS_GOAL_PARITY_SHARD_COUNT: "1",
      ARTEMIS_GOAL_PARITY_SHARD_INDEX: "0",
      ARTEMIS_GOAL_PARITY_EXCLUSIVE_FOCUS_PROBE: "1",
    },
    { phase: "focus-probe" },
    focusProbeTimeoutMs,
  );
}

async function main() {
  const outputDirectory = resolve(
    process.argv[2] ?? join(tmpdir(), "artemis-goal-parity"),
  );
  await mkdir(outputDirectory, { recursive: true });
  const { shardOutcomes, focusProbeOutcome } =
    await runShardsThenExclusiveFocusProbe(
      shardCount,
      (shardIndex) => executeShard(shardIndex, outputDirectory),
      () => executeFocusProbe(outputDirectory),
    );
  for (const outcome of [...shardOutcomes, focusProbeOutcome]) {
    if (outcome.stdout) process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
  }
  const failedShards = shardOutcomes.filter(
    (outcome) => outcome.error !== null || outcome.status !== 0,
  );
  const focusProbeFailed =
    focusProbeOutcome.error !== null || focusProbeOutcome.status !== 0;
  if (failedShards.length > 0 || focusProbeFailed) {
    throw new Error(
      [
        ...failedShards.map(
          (outcome) =>
            `Goal parity shard ${String(outcome.shardIndex + 1)}/${String(shardCount)} failed: ${outcome.error?.message ?? `exit ${String(outcome.status)}`}`,
        ),
        ...(focusProbeFailed
          ? [
              `Goal parity exclusive focus probe failed: ${focusProbeOutcome.error?.message ?? `exit ${String(focusProbeOutcome.status)}`}`,
            ]
          : []),
      ].join("\n"),
    );
  }

  const manifests = await Promise.all(
    Array.from({ length: shardCount }, async (_, shardIndex) =>
      JSON.parse(
        await readFile(
          join(outputDirectory, `manifest.shard-${String(shardIndex)}.json`),
          "utf8",
        ),
      ),
    ),
  );
  const focusProbeManifest = JSON.parse(
    await readFile(
      join(outputDirectory, "focus-probe", "focus-probe.json"),
      "utf8",
    ),
  );
  const manifest = mergeGoalParityShardManifests(manifests, focusProbeManifest);
  const manifestPath = join(outputDirectory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifestPath);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
