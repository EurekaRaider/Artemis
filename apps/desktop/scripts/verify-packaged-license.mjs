import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function verifyPackagedLicense(
  executable,
  userData,
  screenshot,
  args = [],
) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("ARTEMIS_SMOKE_") ||
      ["ELECTRON_RUN_AS_NODE", "ARTEMIS_DEV_SERVER_URL"].includes(key)
    )
      delete env[key];
  }
  const child = spawn(
    executable,
    [
      ...args,
      `--user-data-dir=${userData}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
    ],
    {
      cwd: dirname(executable),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  let exited = false;
  let spawnError;
  const exit = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
      exited = true;
      resolve(null);
    });
    child.once("exit", (code) => {
      exited = true;
      resolve(code);
    });
  });
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  const deadline = Date.now() + 60000;
  async function until(check, label) {
    while (Date.now() < deadline) {
      if (exited)
        throw new Error(
          `Packaged app exited before ${label}: ${spawnError?.message ?? logs}`,
        );
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Packaged activation timed out: ${label}\n${logs}`);
  }
  let socket;
  try {
    const port = await until(
      () => /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/u.exec(logs)?.[1],
      "debug endpoint",
    );
    const page = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(5000),
      });
      return (await response.json()).find(
        (entry) =>
          entry.type === "page" && entry.url.includes("license-ui/index.html"),
      );
    }, "activation page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error
        ? request.reject(new Error(JSON.stringify(message.error)))
        : request.resolve(message.result);
    });
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`CDP timeout: ${method}`));
        }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    }
    await until(
      () =>
        evaluate(
          "Boolean(window.license && document.getElementById('language')?.options.length === 14)",
        ),
      "activation controls",
    );
    const state = await evaluate("window.license.status()");
    assert.equal(
      state.state,
      "unlicensed",
      "Fresh packaged app must show configured, unlicensed activation",
    );
    assert.equal(
      await evaluate("typeof window.artemis"),
      "undefined",
      "Business API must remain unavailable before activation",
    );
    assert.equal(
      await evaluate(
        "window.license.activate('invalid').then(() => false, () => true)",
      ),
      true,
    );
    assert.equal(
      existsSync(join(userData, "artemis.sqlite")),
      false,
      "Business database must not initialize before activation",
    );
    const locales = await evaluate(`(() => {
      const selector = document.getElementById('language');
      const values = Array.from(selector.options, option => option.value);
      for (const value of values) {
        selector.value = value; selector.dispatchEvent(new Event('change'));
        if (document.documentElement.lang !== value) throw new Error('Language did not switch');
      }
      selector.value = 'en'; selector.dispatchEvent(new Event('change'));
      document.getElementById('device').value = 'AM1-' + '0'.repeat(64);
      return values;
    })()`);
    await evaluate(
      "document.fonts.ready.then(() => new Promise(requestAnimationFrame))",
    );
    const capture = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    const bytes = Buffer.from(capture.data, "base64");
    assert(
      bytes.length > 10000,
      "Packaged activation screenshot is unexpectedly small",
    );
    await writeFile(screenshot, bytes);
    await evaluate("setTimeout(() => window.license.quit(), 100); true");
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      assert.equal(await exit, 0, "Packaged activation must exit cleanly");
    } finally {
      clearTimeout(timer);
    }
    return {
      screenshotSha256: createHash("sha256").update(bytes).digest("hex"),
      state: state.state,
      locales,
      businessBlocked: true,
    };
  } finally {
    socket?.close();
    if (!exited) child.kill();
    await exit;
  }
}
