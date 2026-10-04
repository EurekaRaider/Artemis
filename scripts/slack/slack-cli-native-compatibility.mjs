import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  runSlackCli,
  slackCliEnvironment,
  slackHookCommand,
} from "../../apps/desktop/src/main/im/slack-cli-runner.ts";
import { slackAppManifest } from "../../apps/desktop/src/shared/slack-manifest.ts";

const exec = promisify(execFile);

export function verifyPackagedSlackCliCompatibility(directory) {
  return verifySlackCliCompatibility({
    executable: join(
      directory,
      process.platform === "win32" ? "slack.exe" : "slack",
    ),
    hook: resolve(directory, "../app.asar/dist-electron/slack-cli-hook.cjs"),
    nodeExecutable: resolve(
      directory,
      process.platform === "win32"
        ? "../../Artemis.exe"
        : "../../MacOS/Artemis",
    ),
  });
}

/** Native binary + bundled hook. A fresh ticket needs no login or workspace. */
export async function verifySlackCliCompatibility(runtime) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-slack-native-"));
  const manifest = slackAppManifest("Artemis CLI compatibility");
  const secret = randomBytes(32).toString("hex");
  const tokens = {
    appToken: "xapp-native-fixture",
    botToken: "xoxb-native-fixture",
  };
  const windowsPowerShell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  let received;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let input = "";
    socket.setTimeout(10000, () => socket.destroy());
    socket.on("error", () => undefined);
    socket.on("data", (bytes) => (input += bytes));
    socket.on("end", () => {
      try {
        received = JSON.parse(input);
        assert.deepEqual(received, { secret, ...tokens });
        socket.end("ok");
      } catch {
        socket.destroy();
      }
    });
  });
  try {
    await mkdir(join(directory, "config"));
    await mkdir(join(directory, "project", ".slack"), { recursive: true });
    await writeFile(join(directory, "project", "manifest.json"), manifest);
    await writeFile(
      join(directory, "project", ".slack", "config.json"),
      JSON.stringify({ manifest: { source: "local" } }),
    );
    await writeFile(
      join(directory, "project", ".slack", "hooks.json"),
      JSON.stringify({
        hooks: {
          "get-manifest": slackHookCommand(runtime, "manifest"),
          deploy: slackHookCommand(runtime, "deploy"),
        },
        config: { "sdk-managed-connection-enabled": true },
      }),
    );
    // runSlackCli bounds each invocation independently; the direct native
    // probes below also need time for a cold Windows PowerShell startup.
    const command = {
      runtime,
      directory,
      signal: new AbortController().signal,
    };
    if (process.platform === "win32") {
      const probe = await exec(
        windowsPowerShell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `${slackHookCommand(runtime, "manifest")} --source=fixture`,
        ],
        {
          cwd: join(directory, "project"),
          env: slackCliEnvironment({ ...command, args: [] }),
          encoding: "buffer",
          timeout: 60000,
        },
      );
      let actualManifest;
      try {
        actualManifest = JSON.parse(probe.stdout.toString("utf8"));
      } catch {
        throw new Error(
          `Native Windows manifest hook emitted invalid JSON (first bytes: ${probe.stdout.subarray(0, 24).toString("hex")}).`,
        );
      }
      assert.deepEqual(actualManifest, JSON.parse(manifest));
    }
    const info = await runSlackCli({
      ...command,
      args: ["manifest", "info", "--source", "local"],
    });
    let debugLog = "";
    if (info.code !== 0 && process.platform === "win32") {
      const logs = join(directory, "config", "logs");
      const latest = (await readdir(logs).catch(() => [])).sort().at(-1);
      if (latest)
        debugLog = (await readFile(join(logs, latest), "utf8")).slice(-4000);
    }
    assert.equal(
      info.code,
      0,
      `Native CLI manifest hook failed: ${info.output}\n${debugLog}`,
    );
    assert.deepEqual(JSON.parse(info.output.trim()), JSON.parse(manifest));
    const login = await runSlackCli({
      ...command,
      args: ["auth", "login", "--no-prompt"],
    });
    assert.equal(
      login.code,
      0,
      "Native CLI could not obtain an official authorization ticket.",
    );
    assert.match(
      login.output,
      /\/slackauthticket [a-zA-Z0-9+/=_-]{16,2048}(?:\s|$)/u,
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const result = await exec(
      process.platform === "win32" ? windowsPowerShell : runtime.nodeExecutable,
      process.platform === "win32"
        ? ["-Command", slackHookCommand(runtime, "deploy")]
        : [runtime.hook, "deploy"],
      {
        env: {
          ...slackCliEnvironment({
            ...command,
            args: [],
            handoff: { port: server.address().port, secret },
          }),
          SLACK_APP_TOKEN: tokens.appToken,
          SLACK_BOT_TOKEN: tokens.botToken,
        },
        cwd: join(directory, "project"),
        timeout: 60000,
        windowsHide: process.platform !== "win32",
      },
    );
    assert.equal(
      result.stdout + result.stderr,
      "",
      "The token hook must not print credentials.",
    );
    assert.deepEqual(received, { secret, ...tokens });
    return {
      native: `${process.platform}-${process.arch}`,
      manifestHook: true,
      officialAuthorizationTicket: true,
      privateTokenHandoff: true,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
