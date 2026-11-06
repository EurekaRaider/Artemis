import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps runtime contracts free of runtime imports", async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../../src/runtime/runtime-types.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const inputs = Object.entries(result.metafile!.inputs);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]![1].imports).toEqual([]);
});
