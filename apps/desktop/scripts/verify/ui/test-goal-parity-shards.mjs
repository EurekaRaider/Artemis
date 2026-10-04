import assert from "node:assert/strict";

import {
  mergeGoalParityShardManifests,
  runShardsThenExclusiveFocusProbe,
} from "./verify-goal-parity-shards.mjs";

let activeShards = 0;
let maximumActiveShards = 0;
let focusProbeStarted = false;
let focusProbeActiveShards = null;
let releaseShards;
const shardGate = new Promise((resolve) => {
  releaseShards = resolve;
});
const phasedRun = runShardsThenExclusiveFocusProbe(
  3,
  async (shardIndex) => {
    activeShards += 1;
    maximumActiveShards = Math.max(maximumActiveShards, activeShards);
    await shardGate;
    activeShards -= 1;
    return shardIndex;
  },
  async () => {
    focusProbeStarted = true;
    focusProbeActiveShards = activeShards;
    return "focus";
  },
);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(activeShards, 3);
assert.equal(focusProbeStarted, false);
releaseShards();
assert.deepEqual(await phasedRun, {
  shardOutcomes: [0, 1, 2],
  focusProbeOutcome: "focus",
});
assert.equal(maximumActiveShards, 3);
assert.equal(focusProbeActiveShards, 0);

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
    sharedComponents: { focus: null },
  })),
}));
const quietStyle = {
  focusOutlineColor: "rgb(0, 120, 212)",
  focusOutlineStyle: "solid",
  focusOutlineWidth: "2px",
};
const focusProbeManifest = {
  format: "artemis-goal-parity-focus-probe",
  version: 1,
  candidateHead,
  launchMode: "renderer-sandbox",
  totalCaseCount: 6,
  focusProbe: { exclusive: true, caseIndex: 0 },
  caseCount: 1,
  results: [
    {
      caseIndex: 0,
      id: "case-0",
      candidateHead,
      launchMode: "renderer-sandbox",
      screenshot: "case-0.png",
      sharedComponents: {
        contractStyles: { quiet: quietStyle },
        focus: {
          active: true,
          outlineColor: quietStyle.focusOutlineColor,
          outlineStyle: quietStyle.focusOutlineStyle,
          outlineWidth: quietStyle.focusOutlineWidth,
        },
      },
      userDataIsolation: {
        freshStart: true,
        runRootUnexpectedEntries: [],
      },
    },
  ],
};
const merged = mergeGoalParityShardManifests(manifests, focusProbeManifest);
assert.equal(merged.caseCount, 6);
assert.deepEqual(
  merged.results.map((result) => result.caseIndex),
  [0, 1, 2, 3, 4, 5],
);
assert.deepEqual(merged.execution, {
  strategy: "bounded-shards-with-exclusive-focus-probe",
  shardCount: 3,
  exclusiveFocusProbe: true,
});
assert.equal(merged.focusProbe.execution, "exclusive-post-shard");
assert.equal(merged.focusProbe.sharedComponents.focus.active, true);

assert.throws(
  () =>
    mergeGoalParityShardManifests(
      [
        manifests[0],
        manifests[1],
        {
          ...manifests[2],
          results: [
            manifests[2].results[0],
            { ...manifests[2].results[1], caseIndex: 4 },
          ],
        },
      ],
      focusProbeManifest,
    ),
  /duplicate or missing case indexes/u,
);
assert.throws(
  () =>
    mergeGoalParityShardManifests(
      [
        manifests[0],
        manifests[1],
        { ...manifests[2], candidateHead: "c".repeat(40) },
      ],
      focusProbeManifest,
    ),
  /candidate HEADs differ/u,
);
assert.throws(
  () => mergeGoalParityShardManifests(manifests),
  /focus probe has an unsupported format/u,
);
assert.throws(
  () =>
    mergeGoalParityShardManifests(manifests, {
      ...focusProbeManifest,
      candidateHead: "c".repeat(40),
    }),
  /focus probe does not match/u,
);
assert.throws(
  () =>
    mergeGoalParityShardManifests(manifests, {
      ...focusProbeManifest,
      results: [{ ...focusProbeManifest.results[0], id: "case-wrong" }],
    }),
  /focus probe result is invalid/u,
);
assert.throws(
  () =>
    mergeGoalParityShardManifests(manifests, {
      ...focusProbeManifest,
      results: [
        {
          ...focusProbeManifest.results[0],
          sharedComponents: {
            ...focusProbeManifest.results[0].sharedComponents,
            focus: {
              ...focusProbeManifest.results[0].sharedComponents.focus,
              outlineStyle: "none",
            },
          },
        },
      ],
    }),
  /focus contract drifted/u,
);
assert.throws(
  () =>
    mergeGoalParityShardManifests(
      [
        {
          ...manifests[0],
          results: [
            {
              ...manifests[0].results[0],
              sharedComponents: {
                focus: focusProbeManifest.results[0].sharedComponents.focus,
              },
            },
            manifests[0].results[1],
          ],
        },
        manifests[1],
        manifests[2],
      ],
      focusProbeManifest,
    ),
  /must not request OS focus/u,
);

console.log("Goal parity shard orchestration fixtures passed.");
