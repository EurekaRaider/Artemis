import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const cli = resolve("scripts/plugin-tools/cli.mjs");
const run = (...args) =>
  execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
test("a developer can create, validate, pack and invoke an interactive plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-sdk-"));
  let child;
  try {
    const path = join(root, "hello");
    run("init", path, "interactive");
    run("validate", path);
    const zip = join(root, "hello.zip");
    run("pack", path, zip);
    assert.equal((await readFile(zip)).readUInt32LE(), 0x04034b50);
    assert.throws(() => run("pack", path, join(path, "recursive.zip")));
    child = spawn(process.execPath, [join(path, "runtime/index.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let bytes = Buffer.alloc(0);
    const frames = [],
      waiting = [];
    child.stdout.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= 4 && bytes.length >= bytes.readUInt32BE() + 4) {
        const length = bytes.readUInt32BE();
        const message = JSON.parse(bytes.subarray(4, length + 4));
        bytes = bytes.subarray(length + 4);
        const waiter = waiting.shift();
        if (waiter) waiter(message);
        else frames.push(message);
      }
    });
    const send = async (message) => {
      const body = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
      let timer;
      try {
        return await Promise.race([
          frames.length
            ? Promise.resolve(frames.shift())
            : new Promise((resolve) => waiting.push(resolve)),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("runtime response timeout")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    assert.equal(
      (
        await send({
          type: "hello",
          pluginId: "local.hello",
          protocolVersion: 1,
        })
      ).type,
      "ready",
    );
    assert.deepEqual(
      await send({
        type: "tool.invoke",
        requestId: "a",
        toolName: "notes_list",
        arguments: {},
      }),
      {
        type: "tool.result",
        requestId: "a",
        status: "succeeded",
        output: "[]",
      },
    );
    assert.equal(
      (
        await send({
          type: "tool.invoke",
          requestId: "b",
          toolName: "constructor",
          arguments: {},
        })
      ).status,
      "failed",
    );
    assert.equal(
      (
        await send({
          type: "tool.invoke",
          requestId: "c",
          toolName: "notes_list",
          arguments: [],
        })
      ).status,
      "failed",
    );
  } finally {
    if (child) {
      child.kill();
      await new Promise((resolve) => child.once("close", resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
});
test("migration preserves identity, requires review, and refuses silently dropped fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-migrate-"));
  try {
    const manifest = {
      schemaVersion: 1,
      id: "local.example",
      name: "example",
      version: "1.0.0",
      skills: [],
    };
    const file = join(root, "artemis.plugin.json");
    await writeFile(file, JSON.stringify(manifest));
    run("migrate", root);
    const output = join(root, "artemis.plugin.v2.json");
    assert.equal(JSON.parse(await readFile(output)).id, manifest.id);
    assert.deepEqual(JSON.parse(await readFile(file)), manifest);
    assert.throws(() => run("migrate", root));
    await rm(output);
    await writeFile(file, JSON.stringify({ ...manifest, unsupported: true }));
    assert.throws(() => run("migrate", root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
