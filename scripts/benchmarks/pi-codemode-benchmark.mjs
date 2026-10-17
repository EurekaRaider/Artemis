import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "@sinclair/typebox";

const { createCodemodeExtension } = await import(
  process.env.ARTEMIS_PI_BENCHMARK_SDK ?? "@earendil-works/pi-coding-agent"
);

const output = process.argv[2];
const hostAdmission = process.argv.includes("--host-admission");
const { CodemodeWorkerPool } = hostAdmission
  ? await import("../../packages/agent-host/dist/runtime/codemode-workers.js")
  : {};
const measurements = [];
for (const concurrency of [1, 2, 4, 8, 16, 64]) {
  const pool = hostAdmission
    ? new CodemodeWorkerPool(() => concurrency)
    : undefined;
  let tool;
  createCodemodeExtension({
    mode: "only",
    ...(pool ? { acquireWorker: (signal) => pool.acquire(signal) } : {}),
  })({
    registerTool(definition) {
      tool = definition;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
  });
  let active = 0;
  let peak = 0;
  const gate = {
    name: "gate",
    description: "Synthetic I/O",
    parameters: Type.Object({}),
  };
  const context = {
    tools: [gate],
    sessionManager: { getBranch: () => [] },
    async executeTool(name, args, { signal }) {
      active++;
      peak = Math.max(peak, active);
      try {
        await delay(20, undefined, { signal });
      } finally {
        active--;
      }
      return {
        toolCall: { type: "toolCall", id: "gate", name, arguments: args },
        result: { content: [{ type: "text", text: "ok" }] },
        isError: false,
      };
    },
  };
  const rounds = [];
  for (let round = 0; round < 4; round++) {
    peak = 0;
    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        tool.execute(
          `bench-${round}-${i}`,
          { code: "await tools.gate({}); text('ok');" },
          AbortSignal.timeout(60_000),
          undefined,
          context,
        ),
      ),
    );
    if (
      results.some(
        (r) => !JSON.stringify(r.content).includes("Script completed"),
      )
    )
      throw new Error(
        `Codemode failed at concurrency ${concurrency}: ${JSON.stringify(results)}`,
      );
    const elapsedMs = performance.now() - start;
    if (round > 0)
      rounds.push({
        elapsedMs,
        peak,
        tasksPerSecond: (concurrency * 1000) / elapsedMs,
      });
  }
  measurements.push({
    concurrency,
    rounds,
    rssBytes: process.memoryUsage().rss,
  });
  pool?.dispose();
}
const result = { node: process.version, hostAdmission, measurements };
if (output) await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
