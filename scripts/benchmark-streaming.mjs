import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const base = process.argv[2] ?? "a5006f5f746471a3316fa23dd3c8c086bb2e075c";
const directory = await mkdtemp(join(tmpdir(), "artemis-stream-benchmark-"));
try {
  const old = execFileSync(
    "git",
    ["show", `${base}:apps/desktop/src/renderer/App.tsx`],
    { encoding: "utf8" },
  );
  const start = old.indexOf("    const flushAgentEvents = () => {");
  const match = old
    .slice(start)
    .match(
      /setSnapshot\(\(current\) => \{([\s\S]*?)\n      \}\);\n      const visibleText/,
    );
  assert.ok(
    match,
    "baseline stream reducer must be read from the merged source",
  );
  const modules = [];
  for (const [name, contents] of [
    [
      "before",
      `const eventChangesThread = () => false; export function applyStreamBatch(current, batch) {${match[1]}}`,
    ],
    ["after", `export { applyStreamBatch } from './stream-snapshot.ts';`],
  ]) {
    const file = join(directory, `${name}.mjs`);
    await build({
      stdin: {
        contents,
        loader: "ts",
        resolveDir: resolve("apps/desktop/src/renderer"),
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: file,
      logLevel: "silent",
    });
    modules.push([
      name,
      (await import(pathToFileURL(file).href)).applyStreamBatch,
    ]);
  }
  const event = (threadId, seq) => ({
    eventId: `${threadId}-${seq}`,
    threadId,
    seq,
    payload: {
      type: "message.part.delta",
      partId: "answer",
      partType: "text",
      delta: "Synthetic stream text. ",
    },
  });
  const initial = {
    threads: Array.from({ length: 20 }, (_, id) => ({
      id: `t${id}`,
      status: "running",
    })),
    events: Object.fromEntries(
      Array.from({ length: 20 }, (_, id) => [
        `t${id}`,
        Array.from({ length: 1500 }, (_, seq) => event(`t${id}`, seq)),
      ]),
    ),
  };
  const batches = Array.from({ length: 300 }, (_, frame) =>
    Array.from({ length: 64 }, (_, offset) => {
      const thread = `t${frame % 20}`;
      // Reconnect replay plus fresh streaming data exercises the repeated-scan path.
      return event(
        thread,
        offset < 32
          ? 1000 + offset
          : 1500 + Math.floor(frame / 20) * 32 + offset - 32,
      );
    }),
  );
  const results = [];
  let reference;
  for (const [label, apply] of modules) {
    global.gc?.();
    const heapStart = process.memoryUsage().heapUsed;
    let snapshot = structuredClone(initial);
    const times = [];
    for (const batch of batches) {
      const start = performance.now();
      snapshot = apply(snapshot, batch);
      times.push(performance.now() - start);
    }
    if (reference) assert.deepEqual(snapshot, reference);
    else reference = snapshot;
    global.gc?.();
    times.sort((a, b) => a - b);
    results.push({
      label,
      totalMs: times.reduce((a, b) => a + b, 0),
      medianBatchMs: times[Math.floor(times.length / 2)],
      p95BatchMs: times[Math.floor(times.length * 0.95)],
      retainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
    });
  }
  const report = {
    base,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    workload: {
      threads: 20,
      initialEventsPerThread: 1500,
      batches: 300,
      eventsPerBatch: 64,
    },
    boundary:
      "State reducer only; not browser rendering or native GUI acceptance. Heap deltas are process observations, not leak assertions.",
    results,
  };
  await mkdir("artifacts/performance", { recursive: true });
  await writeFile(
    "artifacts/performance/streaming.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
