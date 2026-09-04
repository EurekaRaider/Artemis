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
const shardTimeoutMs = 540_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function runConcurrentShards(count, runShard) {
  assert(Number.isInteger(count) && count > 0, "Shard count must be positive.");
  return Promise.all(
    Array.from({ length: count }, (_, shardIndex) => runShard(shardIndex)),
  );
}

export function mergeGoalParityShardManifests(manifests) {
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

  return {
    format: "artemis-goal-parity",
    version: 4,
    candidateHead,
    launchMode,
    caseCount: totalCaseCount,
    execution: {
      strategy: "bounded-shards",
      shardCount: expectedShardCount,
    },
    userDataIsolation: {
      directory: "user-data/<id> under each shard's throwaway run root",
      note: "Three bounded workers cover disjoint cases. Every sandboxed case gets its own fresh user-data directory, and each case records freshStart plus its shard run-root purity check. There is no --no-sandbox retry path.",
    },
    results,
  };
}

function executeShard(shardIndex, outputDirectory) {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [workerPath, outputDirectory],
      {
        cwd: appDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          ARTEMIS_GOAL_PARITY_SHARD_COUNT: String(shardCount),
          ARTEMIS_GOAL_PARITY_SHARD_INDEX: String(shardIndex),
        },
        maxBuffer: 16 * 1024 * 1024,
        timeout: shardTimeoutMs,
      },
      (error, stdout, stderr) => {
        resolvePromise({
          shardIndex,
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

async function main() {
  const outputDirectory = resolve(
    process.argv[2] ?? join(tmpdir(), "artemis-goal-parity"),
  );
  await mkdir(outputDirectory, { recursive: true });
  const outcomes = await runConcurrentShards(shardCount, (shardIndex) =>
    executeShard(shardIndex, outputDirectory),
  );
  for (const outcome of outcomes) {
    if (outcome.stdout) process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
  }
  const failed = outcomes.filter(
    (outcome) => outcome.error !== null || outcome.status !== 0,
  );
  if (failed.length > 0) {
    throw new Error(
      failed
        .map(
          (outcome) =>
            `Goal parity shard ${String(outcome.shardIndex + 1)}/${String(shardCount)} failed: ${outcome.error?.message ?? `exit ${String(outcome.status)}`}`,
        )
        .join("\n"),
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
  const manifest = mergeGoalParityShardManifests(manifests);
  const manifestPath = join(outputDirectory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(manifestPath);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
