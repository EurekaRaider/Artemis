import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { CodemodeWorkerPool } from "../../src/runtime/codemode-workers.js";
import { AgentConcurrencyLimiter } from "../../src/runtime/agent-concurrency.js";
import {
  createCodemodeExtension,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// Host admission must not also queue behind Pi's process-wide CLI limit.
beforeEach(() => vi.stubEnv("PI_CODEMODE_MAX_WORKERS", "1"));
afterEach(() => vi.unstubAllEnvs());

function codemode(pool = new CodemodeWorkerPool(() => 64)) {
  let tool: ToolDefinition;
  createCodemodeExtension({
    mode: "only",
    models: true,
    acquireWorker: (signal) => pool.acquire(signal),
  })({
    registerTool(value: ToolDefinition) {
      tool = value;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
  } as unknown as ExtensionAPI);
  return tool!;
}

it("uses the shipped self-contained worker without the ESM startup loader", async () => {
  const sdk = import.meta.resolve("@earendil-works/pi-coding-agent");
  const { getCodemodeWorkerSpecifier } = await import(
    new URL("./config.js", sdk).href
  );
  const worker = getCodemodeWorkerSpecifier();
  expect(worker).toBeInstanceOf(URL);
  expect(worker.pathname).toMatch(/\/codemode-worker\.cjs$/);
  const shipped = await readFile(
    new URL("./bundle/chunks/codemode-worker.js", sdk),
    "utf8",
  );
  expect(await readFile(worker, "utf8")).toBe(
    shipped.replace(
      'import{parentPort,workerData}from"node:worker_threads";',
      'const{parentPort,workerData}=require("node:worker_threads");',
    ),
  );
});

it("keeps globals and prototypes isolated between scripts without exposing Node APIs", async () => {
  const pool = new CodemodeWorkerPool(() => 1);
  const tool = codemode(pool);
  try {
    const first = await tool.execute("set-state", {
      code: "globalThis.artemisProbe = 1; Array.prototype.artemisProbe = 1; text('SET');",
    });
    expect(first.isError).not.toBe(true);
    const next = await tool.execute("check-state", {
      code: "text([typeof artemisProbe, typeof [].artemisProbe, typeof process, typeof require, typeof Buffer].join(','));",
    });
    expect(next.isError).not.toBe(true);
    expect(JSON.stringify(next.content)).toContain(
      "undefined,undefined,undefined,undefined,undefined",
    );
    await vi.waitFor(() => expect(pool.snapshot.active).toBe(0));
  } finally {
    pool.dispose();
  }
});

it("retains the VM memory limit and admits a replacement after allocation failure", async () => {
  const pool = new CodemodeWorkerPool(() => 1);
  const tool = codemode(pool);
  try {
    const result = await tool.execute(
      "excessive-allocation",
      {
        code: "const bytes = new Uint8Array(300 * 1024 * 1024); text(bytes.length);",
      },
      AbortSignal.timeout(5_000),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/out of memory|allocation/i);
    const replacement = await tool.execute("after-allocation", {
      code: "text('MEMORY_RECOVERED');",
    });
    expect(replacement.isError).not.toBe(true);
    expect(JSON.stringify(replacement.content)).toContain("MEMORY_RECOVERED");
    await vi.waitFor(() => expect(pool.snapshot.active).toBe(0));
  } finally {
    pool.dispose();
  }
});

it("releases host admission if session preparation fails before a worker starts", async () => {
  const pool = new CodemodeWorkerPool(() => 1);
  const tool = codemode(pool);
  try {
    await expect(
      tool.execute(
        "broken-session",
        { code: "text('unreachable');" },
        undefined,
        undefined,
        {
          tools: [],
          sessionManager: {
            getBranch() {
              throw new Error("Session unavailable");
            },
          },
        } as never,
      ),
    ).rejects.toThrow("Session unavailable");
    expect(pool.snapshot).toEqual({ active: 0, queued: 0 });
    const result = await tool.execute("replacement", {
      code: "text('READY');",
    });
    expect(JSON.stringify(result.content)).toContain("READY");
    await vi.waitFor(() => expect(pool.snapshot.active).toBe(0));
  } finally {
    pool.dispose();
  }
});

it("preserves Pi's default queue, deadline and cancellation when no host hook is supplied", async () => {
  let tool!: ToolDefinition;
  createCodemodeExtension({ mode: "only" })({
    registerTool(value: ToolDefinition) {
      tool = value;
    },
    getSettings: () => ({}),
    getAllTools: () => [],
  } as unknown as ExtensionAPI);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const first = tool.execute(
    "busy",
    { code: "await tools.gate({});" },
    AbortSignal.timeout(5_000),
    undefined,
    {
      tools: [
        { name: "gate", description: "Gate", parameters: Type.Object({}) },
      ],
      sessionManager: { getBranch: () => [] },
      async executeTool(name: string, args: Record<string, unknown>) {
        entered.resolve();
        await release.promise;
        return {
          toolCall: { type: "toolCall", id: "gate", name, arguments: args },
          result: { content: [{ type: "text", text: "ok" }] },
          isError: false,
        };
      },
    } as never,
  );
  try {
    await Promise.race([
      entered.promise,
      first.then(() => {
        throw new Error("Worker did not reach gate");
      }),
    ]);
    const expired = await tool.execute("deadline", {
      code: '// @options: {"timeout_ms": 30}\ntext("MUST_NOT_RUN");',
    });
    expect(expired.isError).toBe(true);
    expect(JSON.stringify(expired.content)).toContain(
      "while waiting for a free codemode worker",
    );
    expect(JSON.stringify(expired.content)).not.toContain("MUST_NOT_RUN");
    const cancelled = await tool.execute(
      "cancelled",
      { code: 'text("MUST_NOT_RUN");' },
      AbortSignal.timeout(30),
    );
    expect(cancelled.isError).toBe(true);
    expect(JSON.stringify(cancelled.content)).toContain("Script aborted");
  } finally {
    release.resolve();
    await first;
  }
  const next = await tool.execute(
    "next",
    { code: 'text("DEFAULT_QUEUE_OK");' },
    AbortSignal.timeout(5_000),
  );
  expect(next.isError).not.toBe(true);
  expect(JSON.stringify(next.content)).toContain("DEFAULT_QUEUE_OK");
});

it("cancels host-queued scripts before starting a worker or executing a tool", async () => {
  const pool = new CodemodeWorkerPool(() => 1);
  const releases = await Promise.all(
    Array.from({ length: 3 }, () => pool.acquire()),
  );
  const controller = new AbortController();
  const executeTool = vi.fn();
  const run = codemode(pool).execute(
    "queued",
    { code: "await tools.gate({});" },
    controller.signal,
    undefined,
    {
      tools: [
        { name: "gate", description: "Gate", parameters: Type.Object({}) },
      ],
      sessionManager: { getBranch: () => [] },
      executeTool,
    } as never,
  );
  try {
    await vi.waitFor(() => expect(pool.snapshot.queued).toBe(1));
    const rejected = expect(run).rejects.toThrow("Cancelled while queued");
    controller.abort(new Error("Cancelled while queued"));
    await rejected;
    expect(executeTool).not.toHaveBeenCalled();
    expect(pool.snapshot).toEqual({ active: 3, queued: 0 });
  } finally {
    controller.abort();
    releases.forEach((release) => release());
    pool.dispose();
    await run.catch(() => {});
  }
});

it("aborts CPU-bound scripts through the caller signal and continues with replacements", async () => {
  const pool = new CodemodeWorkerPool(() => 1);
  const tool = codemode(pool);
  try {
    for (let i = 0; i < 6; i++) {
      const result = await tool.execute(
        `abort-${i}`,
        { code: "while (true) {}" },
        AbortSignal.timeout(100),
      );
      expect(JSON.stringify(result.content)).toMatch(/abort|cancel/i);
      const replacement = await tool.execute(
        `after-abort-${i}`,
        { code: "text('AFTER_ABORT_OK');" },
        AbortSignal.timeout(5_000),
      );
      expect(JSON.stringify(replacement.content)).toContain("AFTER_ABORT_OK");
      expect(replacement.isError).not.toBe(true);
    }
  } finally {
    pool.dispose();
  }
}, 15_000);

it("keeps nested supervisors alive without consuming the runnable child capacity", async () => {
  let pool: CodemodeWorkerPool;
  const limiter = new AgentConcurrencyLimiter(2, 1, () => pool?.refresh());
  pool = new CodemodeWorkerPool(
    () => limiter.snapshot.limit + limiter.snapshot.waiting,
  );
  const tool = codemode(pool);
  const signal = AbortSignal.timeout(10_000);
  const run = (depth: number, kind: "parent" | "child"): Promise<unknown> =>
    limiter.run(
      kind,
      async (lease) =>
        tool.execute(
          `depth-${depth}`,
          {
            code: depth
              ? `text(await tools.child({depth:${depth - 1}}));`
              : "text('NESTED_LEAF_OK');",
          },
          signal,
          undefined,
          {
            tools: [
              {
                name: "child",
                description: "Child",
                parameters: Type.Object({ depth: Type.Number() }),
              },
            ],
            sessionManager: { getBranch: () => [] },
            async executeTool(name: string, args: { depth: number }) {
              const child = await lease.suspend(() => run(args.depth, "child"));
              return {
                toolCall: {
                  type: "toolCall",
                  id: "child",
                  name,
                  arguments: args,
                },
                result: {
                  content: [{ type: "text", text: JSON.stringify(child) }],
                },
                isError: false,
              };
            },
          } as never,
        ),
      signal,
    );
  try {
    expect(JSON.stringify(await run(5, "parent"))).toContain("NESTED_LEAF_OK");
    expect(limiter.snapshot).toMatchObject({
      active: 0,
      waiting: 0,
      queued: 0,
    });
  } finally {
    pool.dispose();
  }
}, 15_000);

it("preserves parallel tool calls inside a single script", async () => {
  const tool = codemode();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const result = await tool.execute(
    "inner-parallel",
    {
      code: "await Promise.all(Array.from({length:8}, () => tools.gate({}))); text('INNER_PARALLEL_OK');",
    },
    AbortSignal.timeout(5_000),
    undefined,
    {
      tools: [
        { name: "gate", description: "Gate", parameters: Type.Object({}) },
      ],
      sessionManager: { getBranch: () => [] },
      async executeTool(name: string, args: Record<string, unknown>) {
        if (++calls === 8) release.resolve();
        await release.promise;
        return {
          toolCall: {
            type: "toolCall",
            id: String(calls),
            name,
            arguments: args,
          },
          result: { content: [{ type: "text", text: "ok" }] },
          isError: false,
        };
      },
    } as never,
  );
  expect(JSON.stringify(result.content)).toContain("INNER_PARALLEL_OK");
  expect(calls).toBe(8);
});

it.each([1, 2, 4, 8, 16, 64])(
  "admits %i concurrent Codemode scripts without serializing tool calls",
  async (count) => {
    const tool = codemode();
    const ready = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let entered = 0;
    const context = {
      tools: [
        { name: "gate", description: "Gate", parameters: Type.Object({}) },
      ],
      sessionManager: { getBranch: () => [] },
      async executeTool(name: string, args: Record<string, unknown>) {
        if (++entered === count) ready.resolve();
        await release.promise;
        return {
          toolCall: { type: "toolCall", id: "gate", name, arguments: args },
          result: { content: [{ type: "text", text: "ok" }] },
          isError: false,
        };
      },
    };
    const controller = new AbortController();
    const runs = Array.from({ length: count }, (_, i) =>
      tool.execute(
        `parallel-${i}`,
        { code: "await tools.gate({}); text('PARALLEL_OK');" },
        AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
        undefined,
        context as never,
      ),
    );
    try {
      await Promise.race([
        ready.promise,
        Promise.all(runs).then(() => {
          if (entered !== count)
            throw new Error(`Only ${entered}/${count} scripts admitted`);
        }),
      ]);
      expect(entered).toBe(count);
    } finally {
      release.resolve();
      controller.abort();
      await Promise.all(runs);
    }
  },
  15_000,
);

it("cancels CPU-bound scripts repeatedly and immediately admits replacement scripts", async () => {
  const tool = codemode();
  for (let i = 0; i < 12; i++) {
    const result = await tool.execute(`timeout-${i}`, {
      code: '// @options: {"timeout_ms": 30}\nwhile (true) {}',
    });
    expect(JSON.stringify(result.content)).toMatch(
      /timeout|deadline|timed out/i,
    );
    const replacement = await tool.execute(`replacement-${i}`, {
      code: "text('REPLACEMENT_OK');",
    });
    expect(JSON.stringify(replacement.content)).toContain("REPLACEMENT_OK");
    expect(replacement.isError).not.toBe(true);
  }
}, 15_000);
