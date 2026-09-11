import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = await realpath(
  await mkdtemp(join(tmpdir(), "artemis-git-refresh-")),
);
const userData = join(output, "profile");
await mkdir(userData);
const env = { ...process.env, ARTEMIS_SMOKE_VIEW: "environment-branch-menu" };
for (const key of [
  "ELECTRON_RUN_AS_NODE",
  "ARTEMIS_SMOKE_SCREENSHOT",
  "ARTEMIS_SMOKE_ACCESSIBILITY",
])
  delete env[key];
const child = spawn(
  createRequire(import.meta.url)("electron"),
  [
    appDirectory,
    `--user-data-dir=${userData}`,
    "--remote-debugging-port=0",
    "--disable-gpu",
  ],
  { cwd: appDirectory, env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
child.stdout.on("data", (data) => (logs += data));
child.stderr.on("data", (data) => (logs += data));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, label) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}`);
};
let socket;
try {
  const port = await until(
    () => /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/u.exec(logs)?.[1],
    "debug port",
  );
  const page = await until(
    async () =>
      (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (tab) => tab.type === "page",
      ),
    "renderer",
  );
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const result = JSON.parse(String(event.data));
    const entry = pending.get(result.id);
    if (!entry) return;
    pending.delete(result.id);
    result.error
      ? entry.reject(new Error(JSON.stringify(result.error)))
      : entry.resolve(result.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      pending.set(request, { resolve, reject });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression: `(async () => (${expression}))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  await until(
    () =>
      evaluate("Boolean(window.artemis && document.querySelector('.sidebar'))"),
    "app ready",
  );
  await evaluate('window.artemis.setLanguage("zh-CN")');
  await evaluate(
    `window.artemis.setTheme(${JSON.stringify(process.argv[2] ?? "dark")})`,
  );
  await send("Page.reload");
  await until(
    () =>
      evaluate(
        "Boolean(window.artemis && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('实现右上角任务环境面板')))",
      ),
    "fixture task",
  );
  await evaluate(
    "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('实现右上角任务环境面板')).click()",
  );
  await until(
    () =>
      evaluate(
        "Boolean(document.querySelector('.environment-branch-row strong'))",
      ),
    "git panel",
  );
  const threadId = "artemis-smoke-environment-thread";
  const local = join(userData, "fixtures", "environment-repository");
  const branch = () =>
    evaluate(`(() => {
    const panel = document.querySelector('.environment-branch-row strong')?.textContent;
    const composer = document.querySelector('.branch-context-trigger span')?.textContent;
    return panel === composer ? panel : undefined;
  })()`);
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const evidence = [];
  for (const name of ["codex/pr-one", "codex/pr-two"]) {
    git(local, "switch", "-c", name);
    await until(async () => (await branch()) === name, `local branch ${name}`);
    evidence.push({ workspace: "local", branch: name });
  }
  const handoff = async (destination) => {
    await evaluate(
      "document.querySelector('.environment-workspace-trigger').click()",
    );
    const label = destination === "local" ? "本地" : "新建本地工作树";
    await evaluate(
      `Array.from(document.querySelectorAll('.environment-workspace-menu button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
    await until(
      async () =>
        (await evaluate(
          `(await window.artemis.getSnapshot()).threads.find(t=>t.id===${JSON.stringify(threadId)})?.target`,
        )) === (destination === "local" ? "local" : "managed-worktree"),
      `handoff ${destination}`,
    );
    const current = await evaluate(
      `(await window.artemis.getSnapshot()).worktrees.find(w=>w.threadId===${JSON.stringify(threadId)}&&w.status==='active')?.path`,
    );
    const path = destination === "local" ? local : current;
    await until(
      async () =>
        (await evaluate(
          "document.querySelector('.environment-workspace-trigger')?.title",
        )) === path,
      `workspace path ${destination}`,
    );
    const notice = await evaluate(`(() => {
      const node=document.querySelector('.transient-notice');
      if (!node) return null;
      const rect=node.getBoundingClientRect();
      return {height:rect.height,text:node.textContent,width:rect.width,x:rect.x,y:rect.y};
    })()`);
    assert.ok(
      notice && notice.height <= 34,
      "Short notifications must remain compact",
    );
    evidence.push({ destination, notice });
    const crop = await send("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: notice.x,
        y: notice.y,
        width: notice.width,
        height: notice.height,
        scale: 1,
      },
    });
    await writeFile(
      join(output, `notice-${evidence.length}.png`),
      Buffer.from(crop.data, "base64"),
    );
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, `handoff-${evidence.length}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
    if (destination === "local") {
      // Synthetic long-text stress check against the real mounted toast styles.
      const wrapped = await evaluate(`(() => {
        const node = document.querySelector('.transient-notice');
        node.style.width = '280px';
        node.querySelector('[data-part="message"]').textContent = '工作区已切换，正在更新分支与文件状态。'.repeat(5);
        const rect = node.getBoundingClientRect();
        const action = node.querySelector('[data-part="action"]').getBoundingClientRect();
        return {height:rect.height, fits:node.scrollWidth <= node.clientWidth && action.right <= rect.right};
      })()`);
      assert.ok(
        wrapped.fits && wrapped.height > 32,
        "Long notifications must wrap without clipping the action",
      );
      evidence.push({ notificationWrapping: wrapped });
      await evaluate(
        "document.querySelector('.transient-notice [data-part=action]').click()",
      );
      await until(
        () => evaluate("!document.querySelector('.transient-notice')"),
        "dismiss notification",
      );
    }
    return path;
  };
  const first = await handoff("managed-worktree");
  git(first, "switch", "-c", "codex/worktree-one");
  await until(
    async () => (await branch()) === "codex/worktree-one",
    "worktree branch refresh",
  );
  evidence.push({ workspace: "worktree", branch: await branch() });
  await handoff("local");
  git(local, "switch", "-c", "codex/local-return");
  await until(
    async () => (await branch()) === "codex/local-return",
    "local return refresh",
  );
  evidence.push({ workspace: "local-return", branch: await branch() });
  const second = await handoff("managed-worktree");

  git(second, "switch", "-c", "codex/worktree-two");
  await until(
    async () => (await branch()) === "codex/worktree-two",
    "second worktree refresh",
  );
  const before = await evaluate(
    "document.querySelector('.environment-diff-total')?.textContent",
  );
  await writeFile(
    join(second, "refresh-proof.txt"),
    "first line\nsecond line\n",
  );
  await until(
    async () =>
      (await evaluate(
        "document.querySelector('.environment-diff-total')?.textContent",
      )) !== before,
    "worktree file refresh",
  );
  evidence.push({
    workspace: "second-worktree",
    branch: await branch(),
    diff: await evaluate(
      "document.querySelector('.environment-diff-total')?.textContent",
    ),
  });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    join(output, "git-refresh.png"),
    Buffer.from(shot.data, "base64"),
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: true, evidence }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, output, evidence }));
} finally {
  socket?.close();
  child.kill("SIGTERM");
  await writeFile(join(output, "electron.log"), logs);
}
