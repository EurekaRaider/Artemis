import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(
  new URL("./verify-ui-boundaries.mjs", import.meta.url),
);

async function fixture(sourcePath, source, manifestOverrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "artemis-ui-boundary-"));
  const manifests = {
    "package.json": { name: "artemis", version: "1.4.41" },
    "packages/theme-contract/package.json": {
      name: "@artemis/theme-contract",
      private: true,
    },
    "packages/ui/package.json": {
      name: "@artemis/ui",
      private: true,
      peerDependencies: { react: ">=19 <20", "react-dom": ">=19 <20" },
    },
    "packages/theme-artemis/package.json": {
      name: "@artemis/theme-artemis",
      private: true,
      dependencies: { "@artemis/theme-contract": "1.4.41" },
    },
    "apps/ui-gallery/package.json": {
      name: "@artemis/ui-gallery",
      private: true,
    },
    "apps/desktop/package.json": { name: "@artemis/desktop", dependencies: {} },
    ...manifestOverrides,
  };
  for (const [path, value] of Object.entries(manifests)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), JSON.stringify(value), "utf8");
  }
  for (const path of [
    "packages/theme-contract/src/index.ts",
    "packages/ui/src/index.ts",
    "packages/theme-artemis/src/index.ts",
    "apps/ui-gallery/src/index.ts",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "export {};\n", "utf8");
  }
  if (sourcePath !== undefined) {
    await writeFile(join(root, sourcePath), source, "utf8");
  }
  return root;
}

async function runCase(
  name,
  sourcePath,
  source,
  expectedSuccess,
  manifestOverrides,
) {
  const root = await fixture(sourcePath, source, manifestOverrides);
  try {
    const result = spawnSync(process.execPath, [checker, "--root", root], {
      encoding: "utf8",
    });
    const succeeded = result.status === 0;
    if (succeeded !== expectedSuccess) {
      throw new Error(
        `${name}: expected success=${expectedSuccess}, exit=${String(result.status)}\n${result.stdout}${result.stderr}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await runCase(
  "safe public import",
  "apps/ui-gallery/src/index.ts",
  'import "@artemis/ui/styles.css";\n',
  true,
);
await runCase(
  "static forbidden import",
  "packages/theme-contract/src/index.ts",
  'export { reducer } from "@artemis/protocol";\n',
  false,
);
await runCase(
  "dynamic forbidden import",
  "packages/theme-artemis/src/index.ts",
  'void import("@artemis/platform");\n',
  false,
);
await runCase(
  "require bypass",
  "packages/ui/src/index.ts",
  'const host = require("@artemis/agent-host");\n',
  false,
);
await runCase(
  "Gallery private source traversal",
  "apps/ui-gallery/src/index.ts",
  'import "../../../packages/ui/src/index.js";\n',
  false,
);
await runCase(
  "Gallery alias bypass",
  "apps/ui-gallery/src/index.ts",
  'import app from "@desktop/renderer";\n',
  false,
);
await runCase("public UI package", undefined, undefined, false, {
  "packages/ui/package.json": {
    name: "@artemis/ui",
    private: false,
    peerDependencies: { react: ">=19 <20", "react-dom": ">=19 <20" },
  },
});
await runCase(
  "workspace dependency version drift",
  undefined,
  undefined,
  false,
  {
    "package.json": { name: "artemis", version: "1.4.42" },
  },
);

console.log("UI boundary negative tests passed (7/7 rejected)");
