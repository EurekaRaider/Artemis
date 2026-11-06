import { build, type Metafile } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

// Inspect emitted dependencies, so erased type imports are not mistaken for
// runtime edges. Dynamic loading is excluded from synchronous cycle checks.
function synchronousCycles(inputs: Metafile["inputs"]): string[][] {
  const graph = new Map(
    Object.entries(inputs).map(([file, data]) => [
      file,
      data.imports
        .filter((item) => !item.external && item.kind !== "dynamic-import")
        .map((item) => item.path),
    ]),
  );
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  function visit(file: string): void {
    if (active.has(file)) {
      cycles.push([...stack.slice(stack.indexOf(file)), file]);
      return;
    }
    if (visited.has(file)) return;
    visited.add(file);
    active.add(file);
    stack.push(file);
    for (const next of graph.get(file) ?? []) if (graph.has(next)) visit(next);
    stack.pop();
    active.delete(file);
  }
  for (const file of graph.keys()) visit(file);
  return cycles;
}

it("detects nested and self cycles, but permits shared leaves and deferred imports", () => {
  const input = (
    ...dependencies: Array<{
      path: string;
      kind?: "import-statement" | "dynamic-import";
      external?: boolean;
    }>
  ): Metafile["inputs"][string] => ({
    bytes: 0,
    imports: dependencies.map((item) => ({
      kind: "import-statement",
      ...item,
    })),
  });
  expect(
    synchronousCycles({
      entry: input({ path: "nested/a" }, { path: "leaf" }),
      "nested/a": input({ path: "nested/b" }),
      "nested/b": input({ path: "nested/a" }),
      leaf: input(),
      self: input({ path: "self" }),
    }),
  ).toEqual([
    ["nested/a", "nested/b", "nested/a"],
    ["self", "self"],
  ]);
  expect(
    synchronousCycles({
      a: input({ path: "b" }, { path: "leaf" }),
      b: input({ path: "a", kind: "dynamic-import" }, { path: "leaf" }),
      leaf: input({ path: "a", external: true }),
    }),
  ).toEqual([]);
});

it.each([
  ["main", "apps/desktop/src/main/bootstrap.ts", "node"],
  ["preload", "apps/desktop/src/preload/preload.ts", "node"],
  ["renderer", "apps/desktop/src/renderer/app/App.tsx", "browser"],
  ["agent-host", "packages/agent-host/src/runtime/runtime.ts", "node"],
  ["gateway", "packages/gateway/src/server.ts", "node"],
] as const)(
  "keeps %s free of synchronous runtime cycles and test dependencies",
  async (_name, entry, platform) => {
    const result = await build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      packages: "external",
      external: [
        "*.css",
        "*.svg",
        "*.png",
        "*.jpg",
        "*.webp",
        "*.wasm",
        "*.node",
      ],
      platform,
      format: "esm",
      target: "esnext",
      logLevel: "silent",
    });
    expect(synchronousCycles(result.metafile!.inputs)).toEqual([]);
    expect(
      Object.keys(result.metafile!.inputs).filter((file) =>
        /(^|\/)(test|tests|fixtures)\/|scripts\/verify\//.test(file),
      ),
    ).toEqual([]);
  },
);
