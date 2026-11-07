import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runSlackCli } from "../../apps/desktop/src/main/im/slack-cli-runner.ts";

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function verifySlackCliProcessTree() {
  const directory = await mkdtemp(join(tmpdir(), "artemis-slack-cancel-"));
  const controller = new AbortController();
  let pids = [];
  let result;
  try {
    await mkdir(join(directory, "project"));
    await mkdir(join(directory, "config"));
    const fixture = fileURLToPath(
      new URL(
        "../../apps/desktop/test/fixtures/im/slack-cli-process-tree.cjs",
        import.meta.url,
      ),
    );
    result = runSlackCli({
      runtime: {
        executable: process.execPath,
        hook: fixture,
        nodeExecutable: process.execPath,
      },
      directory,
      args: [fixture],
      signal: controller.signal,
    }).then(
      () => "unexpected-success",
      (error) => error.message,
    );
    const deadline = Date.now() + 20000;
    while (!pids.length && Date.now() < deadline) {
      try {
        pids = JSON.parse(
          await readFile(
            join(directory, "project", "process-tree.json"),
            "utf8",
          ),
        );
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
          throw error;
        await delay(50);
      }
    }
    assert.equal(
      pids.length,
      2,
      "The fixture must start both processes before cancellation",
    );
    assert.ok(
      pids.every(running),
      "Both processes must be alive before cancellation",
    );
    controller.abort();
    assert.equal(await result, "cancelled");
    const cleanupDeadline = Date.now() + 10000;
    while (pids.some(running) && Date.now() < cleanupDeadline) await delay(50);
    assert.ok(
      pids.every((pid) => !running(pid)),
      "Cancellation must terminate the entire CLI process tree",
    );
    console.log({
      processTreeCancellation: true,
      electron: process.versions.electron,
    });
  } finally {
    controller.abort();
    await result;
    for (const pid of pids) {
      if (running(pid)) process.kill(pid, "SIGKILL");
    }
    await rm(directory, { recursive: true, force: true });
  }
}
