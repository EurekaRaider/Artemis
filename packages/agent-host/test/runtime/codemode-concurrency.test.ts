import { expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { CodemodeWorkerPool } from "../../src/runtime/codemode-workers.js";
import { AgentConcurrencyLimiter } from "../../src/runtime/agent-concurrency.js";
import {
  createCodemodeExtension,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

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
