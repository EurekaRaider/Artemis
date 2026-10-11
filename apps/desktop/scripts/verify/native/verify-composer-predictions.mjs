import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, release } from "node:os";
import { join, resolve } from "node:path";
const { _electron: electron } = await import(
  process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright-core"
);

const require = createRequire(import.meta.url);
const root = await mkdtemp(join(tmpdir(), "artemis-prediction-native-"));
const output =
  process.env.ARTEMIS_PREDICTION_OUTPUT ||
  resolve(
    "artifacts/verification/composer-predictions",
    new Date().toISOString().replaceAll(":", "-"),
  );
await mkdir(output, { recursive: true });
const requests = [];
const correction = "不是直接跑，我是想知道要怎么做";
let holdNext = false;
let releaseHeld;
let held;
const heldRequest = new Promise((resolve) => {
  held = resolve;
});
const server = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  const isTurn = !!body.tools?.length;
  if (isTurn) requests.push(body);
  const last = body.messages?.findLast((m) => m.role === "user");
  const token = JSON.stringify(last?.content).match(
    /\[Artemis composer prediction ([a-zA-Z0-9-]+)\]/u,
  )?.[1];
  const updated = JSON.stringify(last?.content).includes(correction);
  const suggestion = updated ? "请详细解释第一步。" : "请补充测试结果。";
  const text = isTurn
    ? "The synthetic task is complete." +
      (token
        ? `\n<artemis-prediction:${token}>${JSON.stringify({ suggestion })}</artemis-prediction>`
        : "")
    : "Synthetic task";
  if (isTurn && holdNext) {
    holdNext = false;
    await new Promise((resolve) => {
      releaseHeld = resolve;
      held();
    });
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const emit = (delta, finish_reason = null) =>
    response.write(
      `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: "prediction-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  // Real stream fragmentation exercises the adapter, IPC batching and renderer together.
  for (const content of text) emit({ content });
  emit({}, "stop");
  response.end("data: [DONE]\n\n");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let app;
const report = {
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  imeVerification:
    "Synthetic DOM composition events in a native Electron window",
  checks: [],
  errors: [],
};
try {
  app = await electron.launch({
    executablePath:
      process.env.ARTEMIS_PREDICTION_EXECUTABLE || require("electron"),
    args: [
      ...(process.env.ARTEMIS_PREDICTION_EXECUTABLE
        ? []
        : [resolve("apps/desktop")]),
      `--user-data-dir=${join(root, "profile")}`,
    ],
    env: { ...process.env, ARTEMIS_DISABLE_AUTO_UPDATE: "1" },
  });
  const page = await app.firstWindow();
  report.runtime = await app.evaluate(() => ({
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
  }));
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await page.waitForFunction(() => !!window.artemis);
  await page.evaluate(async (baseUrl) => {
    await window.artemis.saveProviderConnection(
      {
        id: "prediction-test",
        name: "Synthetic prediction model",
        api: "openai-completions",
        baseUrl,
        models: [
          {
            id: "prediction-model",
            name: "Prediction test",
            reasoning: false,
            input: ["text"],
            contextWindow: 128000,
            maxTokens: 2048,
          },
        ],
      },
      "synthetic-key",
    );
    await window.artemis.setModelSelection({
      providerId: "prediction-test",
      modelId: "prediction-model",
      thinkingLevel: "off",
    });
    await window.artemis.setLanguage("zh-CN");
  }, `http://127.0.0.1:${server.address().port}/v1`);
  await page.reload();
  const input = page.locator(".composer-input textarea");
  await input.fill("请回复任务已完成，无需工具。");
  await input.press("Enter");
  await page.locator(".composer-prediction").waitFor({ timeout: 30000 });
  assert.equal(await input.inputValue(), "");
  assert.equal(requests.length, 1);
  assert(
    !(await page.locator("body").innerText()).includes("<artemis-prediction:"),
  );
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "prediction.png") });
  await input.press("Tab");
  assert.equal(await input.inputValue(), "请补充测试结果。");
  assert.equal(requests.length, 1);
  report.checks.push(
    "final-only prediction, no raw marker, Tab fills without sending, one model request",
  );
  await input.fill("请再次回复完成。");
  await input.press("Enter");
  await page.locator(".composer-prediction").waitFor({ timeout: 30000 });
  await input.dispatchEvent("compositionstart");
  assert.equal(await page.locator(".composer-prediction").count(), 1);
  await input.press("Tab");
  assert.equal(await input.inputValue(), "");
  await input.fill("ni");
  await input.fill("");
  await input.dispatchEvent("compositionend");
  assert.equal(await page.locator(".composer-prediction").count(), 1);
  await page.evaluate(() => window.artemis.setTheme("dark"));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(850, 650),
  );
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "prediction-dark-narrow.png") });
  assert.equal(requests.length, 2);
  assert(
    !JSON.stringify(
      requests[1].messages.filter((m) => m.role === "assistant"),
    ).includes("artemis-prediction"),
  );
  report.checks.push(
    "IME preserves the suggestion, Tab does not steal input, cancellation restores it; clean provider history",
  );
  await input.press("Escape");
  assert.equal(await page.locator(".composer-prediction").count(), 0);
  await input.fill("请再确认完成。");
  await input.press("Enter");
  await page.locator(".composer-prediction").waitFor({ timeout: 30000 });
  await input.dispatchEvent("compositionstart");
  await input.fill("你好");
  await input.dispatchEvent("compositionend", { data: "你好" });
  assert.equal(await input.inputValue(), "你好");
  assert.equal(await page.locator(".composer-prediction").count(), 0);
  await input.fill("");
  assert.equal(await page.locator(".composer-prediction").count(), 0);
  report.checks.push(
    "Escape dismisses; committed Chinese draft is preserved and dismisses prediction",
  );
  await page.reload();
  await input.waitFor();
  assert.equal(await page.locator(".composer-prediction").count(), 0);
  assert.equal(
    (await page.evaluate(() => window.artemis.getSettings()))
      .composerPredictions,
    true,
  );
  await page.evaluate(() => window.artemis.setComposerPredictions(false));
  await page.reload();
  // Reload also proves that stored completion events do not resurrect suggestions.
  await input.waitFor();
  assert.equal(await page.locator(".composer-prediction").count(), 0);
  const settings = await page.evaluate(() => window.artemis.getSettings());
  assert.equal(settings.composerPredictions, false);
  report.checks.push(
    "opt-out survives reload; history does not restore prediction",
  );
  const watchEvents = () =>
    page.evaluate(() => {
      window.__predictionTestCompleted = false;
      window.artemis.onAgentEvents((events) => {
        for (const event of events) {
          if (event.payload.type === "turn.started")
            window.__predictionTestThread = event.threadId;
          if (event.payload.type === "queue.updated")
            window.__predictionTestQueue = event.payload.followUp;
        }
        if (events.some((event) => event.payload.type === "turn.completed")) {
          window.__predictionTestCompleted = true;
        }
      });
    });
  await watchEvents();
  await input.fill("关闭预测后回复完成。");
  await input.press("Enter");
  await page.waitForFunction(() => window.__predictionTestCompleted === true);
  assert.equal(requests.length, 4);
  assert(
    !JSON.stringify(
      requests[3].messages.findLast((m) => m.role === "user"),
    ).includes("[Artemis composer prediction"),
  );
  assert.equal(await page.locator(".composer-prediction").count(), 0);
  report.checks.push(
    "disabled turn has no prediction instruction and adds only one model request",
  );
  await page.evaluate(() => window.artemis.setComposerPredictions(true));
  await page.reload();
  await input.waitFor();
  await watchEvents();
  holdNext = true;
  await input.fill("请先回复测试任务已完成，无需工具。");
  await input.press("Enter");
  await heldRequest;
  await page.waitForFunction(
    () =>
      window.__predictionTestThread &&
      document.querySelector(".composer-input textarea")?.value === "",
  );
  await input.fill(correction);
  await input.press("Enter");
  await page.waitForFunction(
    (text) => window.__predictionTestQueue?.includes(text),
    correction,
  );
  await page.evaluate(
    (text) =>
      window.artemis.steerQueuedTurn({
        threadId: window.__predictionTestThread,
        followUpIndex: 0,
        expectedFollowUp: [text],
      }),
    correction,
  );
  releaseHeld();
  await page.locator(".composer-prediction").waitFor({ timeout: 30000 });
  assert.equal(
    await page.locator(".composer-prediction span").innerText(),
    "请详细解释第一步。",
  );
  assert.equal(await input.inputValue(), "");
  assert.equal(requests.length, 6);
  const latest = requests.at(-1).messages.findLast((m) => m.role === "user");
  assert(JSON.stringify(latest.content).includes(correction));
  const firstToken = JSON.stringify(requests[4].messages).match(
    /\[Artemis composer prediction ([a-zA-Z0-9-]+)\]/u,
  )?.[1];
  assert(firstToken);
  assert(
    JSON.stringify(latest.content).includes(
      `[Artemis composer prediction ${firstToken}]`,
    ),
  );
  const history = requests
    .at(-1)
    .messages.slice(0, requests.at(-1).messages.indexOf(latest));
  assert(!JSON.stringify(history).includes("Artemis composer prediction"));
  assert(
    !JSON.stringify(history.filter((m) => m.role === "assistant")).includes(
      "artemis-prediction",
    ),
  );
  await page
    .locator(".composer")
    .screenshot({ path: join(output, "prediction-after-supplement.png") });
  await input.press("Tab");
  assert.equal(await input.inputValue(), "请详细解释第一步。");
  assert.equal(requests.length, 6);
  report.checks.push(
    "mid-turn edited message steered from queue: refreshed instruction on latest context, updated prediction displayed and accepted, no extra prediction request",
  );
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  releaseHeld?.();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
