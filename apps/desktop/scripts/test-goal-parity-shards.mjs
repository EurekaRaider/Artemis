import assert from "node:assert/strict";

import {
  mergeGoalParityShardManifests,
  runConcurrentShards,
} from "./verify-goal-parity-shards.mjs";

let activeShards = 0;
let maximumActiveShards = 0;
let releaseShards;
const shardGate = new Promise((resolve) => {
  releaseShards = resolve;
});
const concurrentRun = runConcurrentShards(3, async (shardIndex) => {
  activeShards += 1;
  maximumActiveShards = Math.max(maximumActiveShards, activeShards);
  await shardGate;
  activeShards -= 1;
  return shardIndex;
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(activeShards, 3);
releaseShards();
assert.deepEqual(await concurrentRun, [0, 1, 2]);
assert.equal(maximumActiveShards, 3);

const candidateHead = "b".repeat(40);
const manifests = Array.from({ length: 3 }, (_, shardIndex) => ({
  format: "artemis-goal-parity-shard",
  version: 1,
  candidateHead,
  launchMode: "renderer-sandbox",
  totalCaseCount: 6,
  shard: { index: shardIndex, count: 3 },
  caseCount: 2,
  results: [shardIndex, shardIndex + 3].map((caseIndex) => ({
    caseIndex,
    id: `case-${String(caseIndex)}`,
  })),
}));
const merged = mergeGoalParityShardManifests(manifests);
assert.equal(merged.caseCount, 6);
assert.deepEqual(
  merged.results.map((result) => result.caseIndex),
  [0, 1, 2, 3, 4, 5],
);
assert.deepEqual(merged.execution, {
  strategy: "bounded-shards",
  shardCount: 3,
});

assert.throws(
  () =>
    mergeGoalParityShardManifests([
      manifests[0],
      manifests[1],
      {
        ...manifests[2],
        results: [
          manifests[2].results[0],
          { ...manifests[2].results[1], caseIndex: 4 },
        ],
      },
    ]),
  /duplicate or missing case indexes/u,
);
assert.throws(
  () =>
    mergeGoalParityShardManifests([
      manifests[0],
      manifests[1],
      { ...manifests[2], candidateHead: "c".repeat(40) },
    ]),
  /candidate HEADs differ/u,
);

console.log("Goal parity shard orchestration fixtures passed.");
