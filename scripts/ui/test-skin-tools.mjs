import { strict as assert } from "node:assert";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";

const cli = resolve("artifacts/skin-tools/artemis-skin-tools-1.0.0/cli.mjs");
const run = (cwd, ...args) =>
  execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
test("standalone skin tools build a tampered source into a valid package without altering the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-skin-tools-"));
  try {
    const plugin = join(root, "plugin"),
      output = join(root, "built");
    run(root, "init", plugin, "com.example.tool-test");
    assert.match(run(root, "validate", plugin), /com.example.tool-test/);
    const token = join(plugin, "skins/ocean.artemis-skin/tokens.light.json");
    await writeFile(token, (await readFile(token, "utf8")) + "\n");
    assert.notEqual(
      spawnSync(process.execPath, [cli, "validate", plugin], { cwd: root })
        .status,
      0,
    );
    const before = await readFile(token);
    run(root, "build", plugin, output);
    assert.deepEqual(await readFile(token), before);
    assert.match(run(root, "validate", output), /com.example.tool-test/);
    assert.notEqual(
      spawnSync(process.execPath, [cli, "build", plugin, output], { cwd: root })
        .status,
      0,
    );
    assert.notEqual(
      spawnSync(process.execPath, [cli, "init", plugin], { cwd: root }).status,
      0,
    );
    assert.match(run(root, "validate", output), /com.example.tool-test/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("author SVG conversion emits host geometry and rejects scripts and external references", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-icon-tools-"));
  try {
    const source = join(root, "svg");
    await mkdir(source);
    await writeFile(
      join(source, "search.svg"),
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="6"/><path d="M15 15 L21 21"/></svg>',
    );
    const output = join(root, "icons.json");
    run(root, "convert-icons", source, output);
    const icons = JSON.parse(await readFile(output, "utf8"));
    assert.equal(icons.schemaVersion, 1);
    assert.equal(icons.icons.search[0].fill, false);
    for (const hostile of [
      "<script>alert(1)</script>",
      '<path d="M1 1" onload="alert(1)"/>',
      '<use href="file:///etc/passwd"/>',
    ]) {
      await writeFile(
        join(source, "search.svg"),
        `<svg viewBox="0 0 24 24">${hostile}</svg>`,
      );
      assert.notEqual(
        spawnSync(
          process.execPath,
          [cli, "convert-icons", source, join(root, "bad.json")],
          { cwd: root },
        ).status,
        0,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("both distributed examples satisfy the complete package validator", () => {
  assert.match(
    run(
      tmpdir(),
      "validate",
      resolve("examples/visual-skins/plugins/ocean-visual-skins"),
    ),
    /ocean-static[\s\S]*ocean-video/,
  );
});
test("standalone preview serves only issued assets, including byte ranges", async () => {
  const port = 25000 + Math.floor(Math.random() * 25000);
  const child = spawn(
    process.execPath,
    [
      cli,
      "preview",
      resolve("examples/visual-skins/plugins/ocean-visual-skins"),
      String(port),
    ],
    { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (bytes) => {
      output += String(bytes);
    });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const deadline = Date.now() + 10000;
    while (!output.includes(`http://127.0.0.1:${port}/`)) {
      if (child.exitCode !== null || Date.now() > deadline)
        throw new Error(output || "Preview did not start");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const base = `http://127.0.0.1:${port}`,
      response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy"),
      /connect-src 'none'/,
    );
    const html = await response.text(),
      asset = /\/resource\/[a-f0-9-]+/u.exec(html)?.[0];
    assert.ok(asset);
    const range = await fetch(base + asset, {
      headers: { Range: "bytes=0-7" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 8);
    assert.equal((await fetch(base + "/resource/not-issued")).status, 404);
    assert.equal((await fetch(base + "/etc/passwd")).status, 404);
  } finally {
    child.kill();
    await exited;
  }
});
