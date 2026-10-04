import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const base = process.argv[2] ?? "a5006f5f746471a3316fa23dd3c8c086bb2e075c";
const root = resolve(".");
const directory = await mkdtemp(join(tmpdir(), "artemis-history-benchmark-"));
async function compile(name, contents, resolveDir) {
  const outfile = join(directory, `${name}.mjs`);
  await build({
    stdin: { contents, resolveDir, loader: "ts" },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}
try {
  const { AppStore } = await compile(
    "store",
    `export {AppStore} from './settings/store.ts';`,
    resolve("apps/desktop/src/main"),
  );
  const old = execFileSync(
    "git",
    ["show", `${base}:apps/desktop/src/main/thread-history-reader.ts`],
    { encoding: "utf8" },
  );
  const baseline = await compile(
    "before",
    old,
    resolve("apps/desktop/src/main"),
  );
  const current = await compile(
    "after",
    `export {ThreadHistoryReader} from './conversation/thread-history-reader.ts';`,
    resolve("apps/desktop/src/main"),
  );
  const results = [];
  for (const [label, Reader] of [
    ["before", baseline.ThreadHistoryReader],
    ["after", current.ThreadHistoryReader],
  ]) {
    const db = join(directory, `${label}.sqlite`);
    const store = new AppStore(db);
    const now = new Date().toISOString();
    store.createThread({
      id: "bench",
      title: "Synthetic history",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    let seq = 0;
    for (let turn = 0; turn < 1500; turn++)
      for (const payload of [
        {
          type: "user.message",
          messageId: `u${turn}`,
          text: "Question " + turn,
        },
        { type: "turn.started", mode: "work" },
        {
          type: "message.part.delta",
          partId: `p${turn}`,
          partType: "text",
          delta: "Synthetic answer ".repeat(256),
        },
        {
          type: "turn.completed",
          reason: "completed",
          finalPartId: `p${turn}`,
        },
      ])
        store.appendEvent(`e${++seq}`, "bench", `t${turn}`, payload);
    const reader = new Reader(db);
    const start = performance.now();
    let page = reader.read("bench");
    const initialMs = performance.now() - start;
    const times = [];
    let bytes = 0;
    let pages = 0;
    while (page.cursor) {
      const start = performance.now();
      page = reader.read("bench", page.cursor);
      times.push(performance.now() - start);
      bytes += Buffer.byteLength(JSON.stringify(page));
      pages++;
    }
    times.sort((a, b) => a - b);
    results.push({
      label,
      turns: 1500,
      pages,
      initialMs,
      pageMedianMs: times[Math.floor(times.length / 2)],
      pageP95Ms: times[Math.floor(times.length * 0.95)],
      totalPageMs: times.reduce((a, b) => a + b, 0),
      returnedBytes: bytes,
    });
    reader.close();
    store.close();
  }
  const report = {
    base,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTree: true,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    results,
  };
  await mkdir("artifacts/benchmarks", { recursive: true });
  await writeFile(
    "artifacts/benchmarks/history.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
