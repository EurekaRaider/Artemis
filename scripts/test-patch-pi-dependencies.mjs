import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchPiDependencies } from "./patch-pi-dependencies.mjs";

const root = await mkdtemp(join(tmpdir(), "artemis-pi-patch-"));
const source = join(root, "node_modules", "brace-expansion");
const pi = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
const target = join(pi, "node_modules", "brace-expansion");
const manifest = (version) =>
  JSON.stringify({ name: "brace-expansion", version });
try {
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(
    join(pi, "package.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  await writeFile(join(source, "package.json"), manifest("5.0.12"));
  await writeFile(join(source, "index.js"), "patched implementation");
  await writeFile(join(target, "package.json"), manifest("5.0.9"));
  await writeFile(join(target, "old.js"), "vulnerable implementation");
  await patchPiDependencies(root);
  assert.equal(
    await readFile(join(target, "index.js"), "utf8"),
    "patched implementation",
  );
  await assert.rejects(readFile(join(target, "old.js")), { code: "ENOENT" });
  await patchPiDependencies(root);
  assert.equal(
    JSON.parse(await readFile(join(target, "package.json"))).version,
    "5.0.12",
  );
  await writeFile(
    join(pi, "package.json"),
    JSON.stringify({ version: "1.0.1" }),
  );
  await assert.rejects(patchPiDependencies(root), /Review the Pi shrinkwrap/);
  console.log(
    "Pi dependency patch fixtures passed: replacement, idempotence, version guard.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
