import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { patchPiDependencies } from "./patch-pi-dependencies.mjs";

const root = await mkdtemp(join(tmpdir(), "artemis-pi-resolution-"));
const shared = join(root, "node_modules", "brace-expansion");
const pi = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
const nested = join(pi, "node_modules", "brace-expansion");
const manifest = (version) =>
  JSON.stringify({ name: "brace-expansion", version });
try {
  const cli = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./patch-pi-dependencies.mjs", import.meta.url))],
    { cwd: root, encoding: "utf8" },
  );
  assert.match(cli, /Pi 1\.0\.2 dependency resolution verified/);
  await mkdir(shared, { recursive: true });
  await mkdir(pi, { recursive: true });
  await writeFile(
    join(pi, "package.json"),
    JSON.stringify({ version: "1.0.2" }),
  );
  await writeFile(join(shared, "package.json"), manifest("5.0.12"));
  await patchPiDependencies(root);
  await patchPiDependencies(root);
  // Reject an unsafe nested resolution without mutating it.
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "package.json"), manifest("5.0.9"));
  await assert.rejects(patchPiDependencies(root), /Unexpected Pi dependency/);
  assert.equal(
    JSON.parse(await readFile(join(nested, "package.json"))).version,
    "5.0.9",
  );
  await writeFile(join(nested, "package.json"), manifest("5.0.12"));
  await patchPiDependencies(root);
  await writeFile(
    join(pi, "package.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  await assert.rejects(patchPiDependencies(root), /Unexpected Pi dependency/);
  console.log(
    "Pi dependency checks passed: hoisted/nested resolution, no mutation, version guard.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
