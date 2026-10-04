import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entrypoints = {
  scripts: [],
  "apps/desktop/scripts": [],
  "apps/desktop/src/main": ["main.ts", "bootstrap.ts"],
  "apps/desktop/src/renderer": ["main.tsx", "global.d.ts", "vite-env.d.ts"],
  "apps/desktop/test": [],
  "apps/ui-gallery/src": ["main.tsx", "vite-env.d.ts"],
  "packages/agent-host/src": ["index.ts"],
  "packages/gateway/src": [
    "index.ts",
    "cli.ts",
    "router.ts",
    "server.ts",
    "store.ts",
  ],
};
for (const [directory, allowed] of Object.entries(entrypoints)) {
  const files = (await readdir(join(root, directory), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
  assert.deepEqual(
    files.sort(),
    [...allowed].sort(),
    `${directory}: put feature files in their owning directory`,
  );
}
const manifest = JSON.parse(
  await readFile(join(root, "packages/agent-host/package.json"), "utf8"),
);
for (const name of [
  ".",
  "./builtin-models",
  "./custom-agent-capabilities",
  "./turn-prompt",
]) {
  assert.ok(
    manifest.exports[name],
    `Public export ${name} must remain available`,
  );
}
console.log(
  "Repository layout verified: process entrypoints, feature directories and public exports.",
);
