import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Script } from "node:vm";

// Pi's CLI keeps its two-worker default. Artemis supplies admission through
// this version-scoped SDK hook and retains each reservation until actual exit.
const admissionType =
  "    /** Artemis: reserve until actual worker exit. */\n    acquireWorker?: (signal?: AbortSignal) => Promise<() => void>;";
export const piCodemodePatches = [
  [
    "dist/config.js",
    "    const specifier = resolveCodemodeWorkerSpecifier(runtime, import.meta.url);",
    '    // Artemis SDK: fresh workers use the shipped bundle without the ESM startup loader.\n    if (runtime === "unbundled") return new URL("./bundle/chunks/codemode-worker.cjs", import.meta.url);\n    const specifier = resolveCodemodeWorkerSpecifier(runtime, import.meta.url);',
  ],
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
    "    const admission = await reserveCodemodeWorker(signal, Math.min(deadline, CODEMODE_WORKER_WAIT_MS));",
    '    const releaseWorker = await options.acquireWorker?.(signal);\n    const admission = releaseWorker ? "reserved" : await reserveCodemodeWorker(signal, Math.min(deadline, CODEMODE_WORKER_WAIT_MS));',
  ],
  [
    "dist/extensions/codemode/execute.js",
    "                return releaseCodemodeWorker;",
    "                return releaseWorker ?? releaseCodemodeWorker;",
  ],
  [
    "dist/extensions/codemode/execute.js",
    "        await sandbox?.close();\n        if (reserved) {\n            reserved = false;\n            releaseCodemodeWorker();\n        }",
    "        try { await sandbox?.close(); }\n        finally {\n            if (reserved) {\n                reserved = false;\n                (releaseWorker ?? releaseCodemodeWorker)();\n            }\n        }",
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
    sdk.version !== "1.4.0" ||
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
        throw new Error(`Unexpected Pi 1.4.0 Codemode source: ${path}`);
      source = source.replace(before, after);
    }
    files.set(path, source);
  }
  // Keep Pi's worker implementation intact; only its single built-in import
  // changes module format. Each execution still gets a fresh thread and VM.
  const worker = await readFile(
    join(pi, "dist/bundle/chunks/codemode-worker.js"),
    "utf8",
  );
  const workerImport =
    'import{parentPort,workerData}from"node:worker_threads";';
  if (
    !worker.startsWith(workerImport) ||
    worker.split(workerImport).length !== 2
  )
    throw new Error("Unexpected Pi 1.4.0 Codemode worker bundle");
  const commonjsWorker = worker.replace(
    workerImport,
    'const{parentPort,workerData}=require("node:worker_threads");',
  );
  // Reject future imports/exports or import.meta before writing any patch.
  new Script(commonjsWorker, { filename: "codemode-worker.cjs" });
  files.set("dist/bundle/chunks/codemode-worker.cjs", commonjsWorker);
  // Validate every anchor before writing any file.
  for (const [path, source] of files)
    if (
      source !==
      (await readFile(join(pi, path), "utf8").catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      }))
    )
      await writeFile(join(pi, path), source);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await patchPiDependencies(fileURLToPath(new URL("../../", import.meta.url)));
  console.log(
    "Pi 1.4.0 dependency resolution verified: brace-expansion 5.0.12; Codemode host admission applied.",
  );
}
