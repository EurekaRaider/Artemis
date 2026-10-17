import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pi's CLI keeps its two-worker default. Artemis supplies admission through
// this version-scoped SDK hook and retains each reservation until actual exit.
const admissionType =
  "    /** Artemis: reserve until actual worker exit. */\n    acquireWorker?: (signal?: AbortSignal) => Promise<() => void>;";
export const piCodemodePatches = [
  [
    "dist/index.js",
    "export { AgentSession,",
    'export { exportSessionToHtml } from "./core/export-html/index.js";\nexport { serializeSessionBranch } from "./core/session-export.js";\nexport { AgentSession,',
  ],
  [
    "dist/index.d.ts",
    "export { AgentSession,",
    'export { exportSessionToHtml } from "./core/export-html/index.js";\nexport { serializeSessionBranch } from "./core/session-export.js";\nexport { AgentSession,',
  ],
  [
    "dist/extensions/codemode/index.d.ts",
    "    models?: boolean;",
    `    models?: boolean;\n${admissionType}`,
  ],
  [
    "dist/extensions/codemode/tool.d.ts",
    "    models?: boolean;\n    /**\n     * Persists",
    `    models?: boolean;\n${admissionType}\n    /**\n     * Persists`,
  ],
  [
    "dist/extensions/codemode/index.js",
    "                models: options.models ?? true,",
    "                models: options.models ?? true,\n                acquireWorker: options.acquireWorker,",
  ],
  [
    "dist/extensions/codemode/execute.js",
    "    const sandbox = new CodemodeSandbox({",
    "    const releaseWorker = await options.acquireWorker?.(signal);\n    let workerAcquired = false;\n    let sandbox;\n    let result;\n    try {\n    sandbox = new CodemodeSandbox({",
  ],
  [
    "dist/extensions/codemode/execute.js",
    "        acquireWorker: () => {",
    "        acquireWorker: () => {\n            if (releaseWorker) {\n                workerAcquired = true;\n                return releaseWorker;\n            }",
  ],
  [
    "dist/extensions/codemode/execute.js",
    "    let result;\n    try {\n        const store",
    "    // Artemis admission owns the outer try.\n        const store",
  ],
  [
    "dist/extensions/codemode/execute.js",
    "        await sandbox.close();",
    "        try { await sandbox?.close(); }\n        finally { if (!workerAcquired) releaseWorker?.(); }",
  ],
];

export async function patchPiDependencies(root) {
  const pi = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
  const manifestPath = join(pi, "package.json");
  const sdk = JSON.parse(await readFile(manifestPath, "utf8"));
  const resolve = createRequire(manifestPath);
  const nested = join(pi, "node_modules", "brace-expansion", "package.json");
  const installed = JSON.parse(
    await readFile(nested, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return readFile(resolve.resolve("brace-expansion/package.json"), "utf8");
    }),
  );
  if (
    sdk.version !== "1.3.0" ||
    installed.name !== "brace-expansion" ||
    installed.version !== "5.0.12"
  ) {
    throw new Error(
      "Unexpected Pi dependency resolution; reinstall from the lockfile.",
    );
  }
  const files = new Map();
  for (const [path, before, after] of piCodemodePatches) {
    let source = files.get(path) ?? (await readFile(join(pi, path), "utf8"));
    if (!source.includes(after)) {
      if (source.split(before).length !== 2)
        throw new Error(`Unexpected Pi 1.3.0 Codemode source: ${path}`);
      source = source.replace(before, after);
    }
    files.set(path, source);
  }
  // Validate every anchor before writing any file.
  for (const [path, source] of files)
    if (source !== (await readFile(join(pi, path), "utf8")))
      await writeFile(join(pi, path), source);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await patchPiDependencies(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(
    "Pi 1.3.0 dependency resolution verified: brace-expansion 5.0.12; Codemode host admission applied.",
  );
}
