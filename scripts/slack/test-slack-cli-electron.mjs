// Run inside Electron, whose Windows GUI subsystem has no usable inherited
// console. A plain node.exe parent does not exercise this startup regression.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { verifyPackagedSlackCli } from "./slack-cli-package.mjs";
import { verifySlackCliCompatibility } from "./slack-cli-native-compatibility.mjs";
import { verifySlackCliProcessTree } from "./test-slack-cli-process-tree.mjs";

assert.ok(process.versions.electron, "This probe must run inside Electron");
assert.equal(process.argv.length, 4, "Expected CLI directory and bundled hook");
const [directory, hook] = process.argv.slice(2).map((path) => resolve(path));
console.log(
  await verifyPackagedSlackCli(
    directory,
    `${process.platform}-${process.arch}`,
  ),
);
console.log(
  await verifySlackCliCompatibility({
    executable: join(
      directory,
      process.platform === "win32" ? "slack.exe" : "slack",
    ),
    hook,
    nodeExecutable: process.execPath,
  }),
);
await verifySlackCliProcessTree();
