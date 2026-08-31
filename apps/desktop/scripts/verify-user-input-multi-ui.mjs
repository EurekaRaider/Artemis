import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const positionalArguments = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith("--"));
const outputDirectory = resolve(
  positionalArguments[0] ??
    join(repositoryRoot, "artifacts", "user-input-multi-ui"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-user-input-multi-ui-"),
);
const locale = "en";
const threadId = "artemis-smoke-multi-ui-thread";
const multiRequestId = "artemis-smoke-multi-ui";
const legacyRequestId = "artemis-smoke-multi-ui-single";
const expiredRequestId = "artemis-smoke-multi-ui-expired";
const cancelRequestId = "artemis-smoke-multi-ui-cancel";
const customAnswer = "Ship after the changelog lands.";

// D#76 PR10C A8: the multi-question card must be driven by REAL UI
// operations — CDP Input-level mouse presses and key events against the
// built production renderer, with main.ts contributing only the #124-style
// seeding channel. Four launches: the full Q1 -> Q2 -> Q3 interactive round
// in both themes, the mixed-expiry timeout arm, and the thread-cancel arm.
const steps = [
  {
    id: "multi-ui-flow",
    view: "multi-question-ui",
    themes: ["light", "dark"],
    zoomArm: true,
    scenario:
      "Full interactive round: pending 3-question card renders with roving dots and per-question countdowns, Q1 answered by a real recommended-option click, Q2 reached by real keyboard (dot ArrowRight, option Shift+Tab entry) and answered by a real Enter activation, Q3 answered through the other-inline custom form with an IME-safe Enter, then duplicate resolutions rejected, the legacy single-question card answered end to end, and a 200% zoom layout pass.",
  },
  {
    id: "multi-ui-expired",
    view: "multi-question-ui-expired",
    themes: ["light"],
    zoomArm: false,
    scenario:
      "Timeout arm: a seeded already-expired first question resolves through the timer's own resolution function with the recommended label while the live second question stays answerable by hand and the card settles as a mixed timed-out aggregate.",
  },
  {
    id: "multi-ui-cancel",
    view: "multi-question-ui-cancel",
    themes: ["light"],
    zoomArm: false,
    scenario:
      "Cancel arm: cancelling the thread through the renderer's own cancelTurn IPC emits exactly one kind-less cancelled resolution and renders the whole card cancelled.",
  },
];
const cases = steps.flatMap((step) =>
  step.themes.map((theme) => ({
    ...step,
    theme,
    caseId: `${step.id}-${theme}`,
  })),
);
const results = [];
// Random per-invocation debug-port base: a leaked Electron from an earlier
// (failed) run must never still own the port a new launch expects to bind.
const portBase = 24_000 + Math.floor(Math.random() * 20_000);

const cardSnapshotExpression = `(() => {
  const card = document.querySelector(".user-input-card.multi-question");
  const legacyCards = [
    ...document.querySelectorAll(".user-input-card:not(.multi-question)"),
  ];
  if (!card) return { present: false };
  const slides = [...card.querySelectorAll(".user-question-slide")];
  const dots = [...card.querySelectorAll(".user-question-dot")];
  const progress = card.querySelector(".user-question-progress-bar");
  const time = card.querySelector(".user-input-timeout");
  const otherForm = card.querySelector(".user-input-other-inline");
  const active = document.activeElement;
  const rect = (element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height,
    };
  };
  return {
    present: true,
    status: card.getAttribute("class"),
    pending: card.classList.contains("pending"),
    answered: card.classList.contains("answered"),
    timedOut: card.classList.contains("timed-out"),
    cancelled: card.classList.contains("cancelled"),
    eyebrow: card.querySelector(".user-input-eyebrow")?.textContent ?? null,
    progressText:
      card.querySelector(".user-question-progress-text")?.textContent ?? null,
    progressNow: progress?.getAttribute("aria-valuenow") ?? null,
    progressMin: progress?.getAttribute("aria-valuemin") ?? null,
    progressMax: progress?.getAttribute("aria-valuemax") ?? null,
    slideCount: slides.length,
    activeSlideIndex: slides.findIndex((slide) =>
      slide.classList.contains("active"),
    ),
    slideTexts: slides.map((slide) =>
      (slide.textContent ?? "").replace(/\\s+/gu, " ").trim(),
    ),
    dotCount: dots.length,
    dotTabIndexes: dots.map((dot) => dot.tabIndex),
    dotSelected: dots.map((dot) => dot.getAttribute("aria-selected")),
    dotClasses: dots.map((dot) => dot.getAttribute("class")),
    tablistRole:
      card.querySelector(".user-question-dots")?.getAttribute("role") ?? null,
    timeDateTime: time?.getAttribute("datetime") ?? null,
    timeText: time?.textContent?.trim() ?? null,
    activeOptions: [
      ...card.querySelectorAll(".user-question-slide.active .user-input-option"),
    ].map((button) => ({
      label:
        button.querySelector(".user-input-option-title strong")?.textContent ??
        null,
      other: button.classList.contains("other"),
      recommended: button.classList.contains("recommended"),
      disabled: button.disabled,
      tabIndex: button.tabIndex,
      rect: rect(button),
    })),
    otherFormPresent: otherForm !== null,
    otherInputValue:
      otherForm?.querySelector("input")?.value ??
      card
        ?.querySelector(".user-question-slide.active .user-input-other-inline input")
        ?.value ??
      null,
    resultStrips: [...card.querySelectorAll(".user-question-result")].map(
      (strip) => (strip.textContent ?? "").replace(/\\s+/gu, " ").trim(),
    ),
    cardRect: rect(card),
    dotsRect: rect(card.querySelector(".user-question-dots")),
    activeElement: active
      ? {
          tag: active.tagName,
          className: active.getAttribute("class"),
          role: active.getAttribute("role"),
          text: (active.textContent ?? "").replace(/\\s+/gu, " ").trim(),
        }
      : null,
    legacyCards: legacyCards.map((legacy) => ({
      status: legacy.getAttribute("class"),
      pending: legacy.classList.contains("pending"),
      answered: legacy.classList.contains("answered"),
      question: legacy.querySelector(".user-input-question")?.textContent ?? null,
    })),
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  };
})()`;

class CdpConnection {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    webSocket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? "CDP error"));
      } else {
        entry.resolve(message.result);
      }
    });
  }

  static async connect(url) {
    const webSocket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      webSocket.addEventListener("open", resolve, { once: true });
      webSocket.addEventListener("error", reject, { once: true });
    });
    return new CdpConnection(webSocket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          // A DevTools peer that stopped answering must never strand the
          // driver: fail the call and tear the socket down.
          this.webSocket.close();
          rejectPromise(new Error(`CDP ${method} timed out after 30s`));
        }
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

class Driver {
  constructor(connection) {
    this.connection = connection;
  }

  async evaluate(expression) {
    const evaluation = await this.connection.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (evaluation.exceptionDetails) {
      throw new Error(
        `Runtime.evaluate failed: ${evaluation.exceptionDetails.text}`,
      );
    }
    return evaluation.result?.value;
  }

  async cardSnapshot() {
    return this.evaluate(cardSnapshotExpression);
  }

  async waitForCard(description, predicate, timeoutMilliseconds = 8_000) {
    const deadline = Date.now() + timeoutMilliseconds;
    for (;;) {
      const snapshot = await this.cardSnapshot();
      if (snapshot.present && predicate(snapshot)) return snapshot;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for ${description}; last snapshot ${JSON.stringify(snapshot)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async waitForElement(expression, description, timeoutMilliseconds = 8_000) {
    const deadline = Date.now() + timeoutMilliseconds;
    for (;;) {
      const found = await this.evaluate(`Boolean(${expression})`);
      if (found) return;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for element ${description}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async evaluateElementRect(elementExpression) {
    return this.evaluate(
      `(() => {
      const element = ${elementExpression};
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "center" });
      return true;
    })()`,
    ).then(() =>
      this.evaluate(`(() => {
        const element = ${elementExpression};
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      })()`),
    );
  }

  async readBounds(elementExpression) {
    return this.evaluate(`(() => {
      const element = ${elementExpression};
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    })()`);
  }

  async clickElement(elementExpression, description) {
    // scrollIntoView can animate (smooth scroll containers) and the hover
    // mouseMoved below reflows hover-sensitive layouts, so the press
    // coordinates are re-read after both effects settle — a stale rect
    // clicks the wrong neighbor in dense option lists.
    const scrolled = await this.evaluate(`(() => {
      const element = ${elementExpression};
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      return true;
    })()`);
    if (!scrolled) {
      throw new Error(`clickElement: ${description} not found`);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    let bounds = await this.readBounds(elementExpression);
    if (!bounds) {
      throw new Error(`clickElement: ${description} not found after scroll`);
    }
    const center = () => ({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
    const inViewport = (point, viewport) =>
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < viewport.innerWidth &&
      point.y < viewport.innerHeight;
    let viewport = await this.evaluate(
      "({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })",
    );
    if (!inViewport(center(), viewport)) {
      throw new Error(
        `clickElement: ${description} center ${JSON.stringify(center())} outside viewport ${viewport.innerWidth}x${viewport.innerHeight}`,
      );
    }
    await this.connection.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: center().x,
      y: center().y,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    bounds = await this.readBounds(elementExpression);
    viewport = await this.evaluate(
      "({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })",
    );
    if (!bounds || !inViewport(center(), viewport)) {
      throw new Error(
        `clickElement: ${description} moved out of reach after hover (${JSON.stringify(bounds)})`,
      );
    }
    await this.connection.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: center().x,
      y: center().y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await this.connection.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: center().x,
      y: center().y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
  }

  async clickActiveOptionByLabel(label) {
    await this.clickElement(
      `[...document.querySelectorAll(".user-question-slide.active .user-input-option")].find((button) => button.querySelector(".user-input-option-title strong")?.textContent === ${JSON.stringify(label)})`,
      `active option "${label}"`,
    );
  }

  async pressKey(key, virtualKeyCode, options = {}) {
    const parameters = {
      key,
      code: options.code ?? key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers: options.modifiers ?? 0,
      ...(options.text ? { text: options.text } : {}),
    };
    await this.connection.send("Input.dispatchKeyEvent", {
      ...parameters,
      type: options.text ? "keyDown" : "rawKeyDown",
    });
    await this.connection.send("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  }

  async insertText(text) {
    await this.connection.send("Input.insertText", { text });
  }

  async screenshot(path) {
    const capture = await this.connection.send("Page.captureScreenshot", {
      format: "png",
    });
    await writeFile(path, Buffer.from(capture.data, "base64"));
    return (await stat(path)).size;
  }

  async storePayloads() {
    const payloads = await this.evaluate(
      `window.artemis.getThreadEvents(${JSON.stringify(
        threadId,
      )}).then((events) => events.map((event) => event.payload))`,
    );
    return payloads ?? [];
  }

  async storeEvents(requestId, type) {
    const payloads = await this.storePayloads();
    return payloads.filter(
      (payload) => payload.type === type && payload.requestId === requestId,
    );
  }

  async tryResolveDuplicate(questionId, choice) {
    const requested = await this.storeEvents(
      multiRequestId,
      "user-input.requested",
    );
    const nonce = requested[0]?.nonce ?? "";
    return this.evaluate(
      `window.artemis.resolveUserInput(${JSON.stringify({
        requestId: multiRequestId,
        nonce,
        kind: "multi-question",
        questionId,
        ...choice,
      })}).then(() => ({ rejected: false }), (error) => ({
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      }))`,
    );
  }
}

async function fetchJson(url, timeoutMilliseconds = 2_000) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function waitForTarget(port) {
  const deadline = Date.now() + 40_000;
  for (;;) {
    try {
      const targets = await fetchJson(
        `http://127.0.0.1:${port}/json/list`,
        1_500,
      );
      const page = targets.find(
        (target) =>
          target.type === "page" && (target.url ?? "").includes("index.html"),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Endpoint not up yet.
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the smoke page CDP target");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function launchAndDrive(caseId, attempt, environment, drive) {
  const port =
    portBase +
    cases.findIndex((entry) => entry.caseId === caseId) * 11 +
    attempt;
  const caseUserDataDirectory = join(
    temporaryDirectory,
    "user-data",
    "user-input-multi-ui",
    `${caseId}-attempt-${attempt}`,
  );
  const userDataPreexisting = existsSync(caseUserDataDirectory);
  const child = spawn(
    electronPath,
    [
      appDirectory,
      `--user-data-dir=${caseUserDataDirectory}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      ...(attempt === 1 ? ["--no-sandbox"] : []),
    ],
    {
      cwd: appDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
    if (output.length > 60_000) output = output.slice(-60_000);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
    if (output.length > 60_000) output = output.slice(-60_000);
  });
  const killChildTree = async () => {
    if (child.exitCode !== null || child.signal !== null) return;
    child.kill("SIGKILL");
    for (let step = 0; step < 10; step += 1) {
      if (child.exitCode !== null || child.signal !== null) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // Escalate: macOS may have reparented the app bundle away from us.
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("pkill", ["-9", "-P", String(child.pid)], {
        stdio: "ignore",
      });
    } catch {
      // Best effort only.
    }
  };
  const fail = async (message) => {
    await killChildTree();
    throw new Error(
      `${message}\n--- Electron output tail ---\n${output.slice(-4_000)}`,
    );
  };
  const withTimeout = (promise, milliseconds, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        ),
      ),
    ]);
  try {
    const target = await waitForTarget(port);
    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      const outcome = await withTimeout(
        (async () => {
          await connection.send("Runtime.enable");
          await connection.send("Page.enable");
          // The spawned window renders without becoming the OS frontmost app;
          // bringToFront is the protocol-level window activation so the focus
          // evidence (document.hasFocus, focus event chains) is real.
          await connection.send("Page.bringToFront").catch(() => undefined);
          const driver = new Driver(connection);
          // Deterministic locale and theme: apply the real settings IPC (the
          // same path the Settings panel uses) for the persisted English
          // locale and the case theme, then reload so the renderer remounts
          // with those preferences (the panel applies them reactively through
          // its own state; a scripted change needs the remount).
          const prepared = await driver.evaluate(
            `Promise.all([
              window.artemis.setLanguage("en"),
              window.artemis.setTheme(${JSON.stringify(environment.ARTEMIS_SMOKE_THEME)}),
            ]).then(() => true)`,
          );
          if (prepared !== true) {
            throw new Error("settings preparation (locale/theme) failed");
          }
          await connection.send("Page.reload");
          await driver.waitForElement(
            `document.querySelector(".thread-select")`,
            "thread selector after settings reload",
            30_000,
          );
          await connection.send("Page.bringToFront").catch(() => undefined);
          return await drive(driver, () => userDataPreexisting);
        })(),
        300_000,
        "case drive",
      );
      await connection.send("Browser.close").catch(() => undefined);
      connection.close();
      const waitForExit = (milliseconds) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve("timeout"), milliseconds);
          child.once("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        });
      let exitCode = await waitForExit(12_000);
      let forcedTeardown = false;
      if (exitCode !== 0) {
        // The drive itself passed; the agent-host teardown can outlive
        // Browser.close, so escalate signals and record the forced exit
        // instead of failing the case after the fact.
        forcedTeardown = true;
        child.kill("SIGTERM");
        exitCode = await waitForExit(5_000);
        if (exitCode !== 0) {
          await killChildTree();
          exitCode = await waitForExit(5_000);
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      return {
        outcome,
        output,
        userDataPreexisting,
        teardown: { exitCode, forcedTeardown },
      };
    } finally {
      connection.close();
    }
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
}

function makeAssertions(caseId) {
  const assertions = [];
  const assert = (name, pass, actual, expected) => {
    const record = { name, pass, actual, expected };
    assertions.push(record);
    if (!pass) {
      throw new Error(
        `${caseId} assertion failed: ${name} (actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`,
      );
    }
    return record;
  };
  return { assertions, assert };
}

async function driveMainFlow(driver, testCase, artifactsFor) {
  const { assertions: driveAssertions, assert } = makeAssertions(
    testCase.caseId,
  );
  const screenshots = [];

  await driver.waitForElement(
    `document.querySelector(".thread-select")`,
    "thread selector",
    20_000,
  );
  assert(
    "0-document-has-focus",
    (await driver.evaluate("document.hasFocus()")) === true,
    await driver.evaluate("document.hasFocus()"),
    true,
  );
  assert(
    "0-theme-applied",
    (await driver.evaluate(
      `matchMedia("(prefers-color-scheme: dark)").matches`,
    )) ===
      (testCase.theme === "dark"),
    await driver.evaluate(`matchMedia("(prefers-color-scheme: dark)").matches`),
    testCase.theme === "dark",
  );
  await driver.clickElement(
    `document.querySelector(".thread-select")`,
    "thread select",
  );

  // (1) Pending render assertions.
  await driver.waitForCard(
    "pending 3-question card",
    (snapshot) => snapshot.pending && snapshot.slideCount === 3,
    20_000,
  );
  const requested = await driver.storeEvents(
    multiRequestId,
    "user-input.requested",
  );
  assert(
    "1-multi-request-persisted",
    requested.length === 1,
    requested.length,
    1,
  );
  const requestedQuestions = requested[0]?.questions ?? [];
  const deadlineByQuestion = Object.fromEntries(
    requestedQuestions.map((question) => [
      question.questionId,
      question.expiresAt,
    ]),
  );
  assert(
    "1-request-frozen-kind",
    requested[0]?.kind === "multi-question",
    requested[0]?.kind ?? null,
    "multi-question",
  );
  assert(
    "1-request-three-questions",
    requestedQuestions.length === 3,
    requestedQuestions.length,
    3,
  );
  assert(
    "1-request-per-question-expiry",
    requestedQuestions.every(
      (question) =>
        typeof question.expiresAt === "string" &&
        Number.isFinite(Date.parse(question.expiresAt)),
    ),
    requestedQuestions.map((question) => question.expiresAt ?? null),
    "a finite ISO expiresAt per question",
  );
  let snapshot = await driver.waitForCard(
    "pending 3-question card",
    (state) => state.pending && state.slideCount === 3,
  );
  assert(
    "1-pending-card-present",
    snapshot.pending === true,
    snapshot.pending,
    true,
  );
  assert(
    "1-legacy-card-pending-beside-multi",
    snapshot.legacyCards.length === 1 &&
      snapshot.legacyCards[0]?.pending === true,
    snapshot.legacyCards,
    "one pending legacy card",
  );
  assert(
    "1-card-eyebrow",
    snapshot.eyebrow === "Plan check",
    snapshot.eyebrow,
    "Plan check",
  );
  assert(
    "1-slide-count-three",
    snapshot.slideCount === 3,
    snapshot.slideCount,
    3,
  );
  assert(
    "1-first-slide-active",
    snapshot.activeSlideIndex === 0,
    snapshot.activeSlideIndex,
    0,
  );
  assert(
    "1-slide-1-shows-q1",
    snapshot.slideTexts[0]?.includes("Ship the release on Friday?") === true,
    snapshot.slideTexts[0],
    "contains 'Ship the release on Friday?'",
  );
  assert(
    "1-slide-3-shows-q3",
    snapshot.slideTexts[2]?.includes("Add anything to the notes?") === true,
    snapshot.slideTexts[2],
    "contains 'Add anything to the notes?'",
  );
  assert(
    "1-progress-zero-of-three",
    snapshot.progressText === "0/3 answered" &&
      snapshot.progressNow === "0" &&
      snapshot.progressMin === "0" &&
      snapshot.progressMax === "3",
    {
      progressText: snapshot.progressText,
      progressNow: snapshot.progressNow,
      progressMin: snapshot.progressMin,
      progressMax: snapshot.progressMax,
    },
    {
      progressText: "0/3 answered",
      progressNow: "0",
      progressMin: "0",
      progressMax: "3",
    },
  );
  assert(
    "1-dots-tablist-role",
    snapshot.tablistRole === "tablist",
    snapshot.tablistRole,
    "tablist",
  );
  assert(
    "1-dots-roving-single-tab-stop",
    snapshot.dotTabIndexes.filter((tabIndex) => tabIndex === 0).length === 1 &&
      snapshot.dotTabIndexes[0] === 0,
    snapshot.dotTabIndexes,
    "exactly one tabIndex 0, on the active dot",
  );
  assert(
    "1-dots-selected-on-active-only",
    snapshot.dotSelected.join(",") === "true,false,false",
    snapshot.dotSelected,
    ["true", "false", "false"],
  );
  assert(
    "1-countdown-reads-q1-deadline",
    snapshot.timeDateTime === deadlineByQuestion.q1,
    snapshot.timeDateTime,
    deadlineByQuestion.q1 ?? null,
  );
  const countdownText = snapshot.timeText ?? "";
  assert(
    "1-countdown-live-text",
    /^(9|10):[0-5]\d$/u.test(countdownText),
    countdownText,
    "9:xx or 10:xx",
  );

  // Real keyboard question navigation with per-question countdown checks.
  await driver.clickElement(
    `document.querySelectorAll(".user-question-dot")[0]`,
    "question dot 1",
  );
  snapshot = await driver.waitForCard("dot 1 focused", (state) =>
    Boolean(state.activeElement && state.activeElement.role === "tab"),
  );
  assert(
    "1-dot-click-focuses-dot",
    snapshot.activeElement?.role === "tab",
    snapshot.activeElement,
    "a role=tab dot holds focus",
  );
  await driver.pressKey("ArrowRight", 39);
  snapshot = await driver.waitForCard(
    "question 2 active after ArrowRight",
    (state) => state.activeSlideIndex === 1 && state.dotSelected[1] === "true",
  );
  assert(
    "1-arrowright-moves-to-q2",
    snapshot.activeSlideIndex === 1 &&
      snapshot.dotSelected.join(",") === "false,true,false",
    {
      activeSlideIndex: snapshot.activeSlideIndex,
      dotSelected: snapshot.dotSelected,
    },
    { activeSlideIndex: 1, dotSelected: ["false", "true", "false"] },
  );
  assert(
    "1-countdown-reads-q2-deadline",
    snapshot.timeDateTime === deadlineByQuestion.q2 &&
      snapshot.timeDateTime !== deadlineByQuestion.q1,
    snapshot.timeDateTime,
    `${deadlineByQuestion.q2 ?? null} (distinct from q1)`,
  );
  await driver.pressKey("ArrowRight", 39);
  snapshot = await driver.waitForCard(
    "question 3 active after ArrowRight",
    (state) => state.activeSlideIndex === 2,
  );
  assert(
    "1-countdown-reads-q3-deadline",
    snapshot.timeDateTime === deadlineByQuestion.q3 &&
      snapshot.timeDateTime !== deadlineByQuestion.q2 &&
      snapshot.timeDateTime !== deadlineByQuestion.q1,
    snapshot.timeDateTime,
    `${deadlineByQuestion.q3 ?? null} (distinct from q1 and q2)`,
  );
  await driver.pressKey("Home", 36);
  await driver.waitForCard(
    "Home returns to q1",
    (state) => state.activeSlideIndex === 0,
  );
  await driver.pressKey("End", 35);
  snapshot = await driver.waitForCard(
    "End jumps to q3",
    (state) => state.activeSlideIndex === 2,
  );
  assert(
    "1-home-end-jump-questions",
    snapshot.activeSlideIndex === 2,
    snapshot.activeSlideIndex,
    2,
  );
  screenshots.push({
    name: `${testCase.caseId}-01-pending.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-01-pending.png`),
    ),
  });

  // (2) Real click answers Q1 with the recommended option.
  await driver.pressKey("Home", 36);
  await driver.waitForCard(
    "Home returns to q1 for answering",
    (state) => state.activeSlideIndex === 0,
  );
  await driver.clickActiveOptionByLabel("Ship it");
  // The auto-advance lands one rAF after the answers update, so the wait
  // must gate on both the progress and the advanced slide.
  snapshot = await driver.waitForCard(
    "progress 1/3 and slide advanced after Q1 click",
    (state) =>
      state.progressText === "1/3 answered" && state.activeSlideIndex === 1,
  );
  assert(
    "2-progress-one-of-three",
    snapshot.progressText === "1/3 answered" && snapshot.progressNow === "1",
    { progressText: snapshot.progressText, progressNow: snapshot.progressNow },
    { progressText: "1/3 answered", progressNow: "1" },
  );
  assert(
    "2-q1-dot-done",
    snapshot.dotClasses[0]?.includes("done") === true &&
      snapshot.dotClasses[1]?.includes("active") === true,
    snapshot.dotClasses,
    "q1 dot done, q2 dot active",
  );
  assert(
    "2-card-advances-to-q2",
    snapshot.activeSlideIndex === 1,
    snapshot.activeSlideIndex,
    1,
  );
  let resolved = await driver.storeEvents(
    multiRequestId,
    "user-input.resolved",
  );
  assert(
    "2-resolved-exactly-one-kind-user",
    resolved.length === 1 &&
      resolved[0]?.kind === "multi-question" &&
      resolved[0]?.questionId === "q1" &&
      resolved[0]?.source === "user" &&
      resolved[0]?.selectedOptionLabel === "Ship it",
    resolved,
    "exactly one kind'd resolved event for q1 with source user and label 'Ship it'",
  );
  assert(
    "2-legacy-card-untouched",
    snapshot.legacyCards[0]?.pending === true,
    snapshot.legacyCards,
    "legacy card still pending (no final backfill yet)",
  );
  assert(
    "2-no-extra-resolution-events",
    (await driver.storeEvents(multiRequestId, "user-input.resolved")).length ===
      1,
    (await driver.storeEvents(multiRequestId, "user-input.resolved")).length,
    1,
  );
  screenshots.push({
    name: `${testCase.caseId}-02-q1-click-answered.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-02-q1-click-answered.png`),
    ),
  });

  // (6a) Duplicate resolution of an answered question is rejected and the
  // resolved-event count stays exactly one.
  const duplicateMidCard = await driver.tryResolveDuplicate("q1", {
    selectedOptionLabel: "Ship it",
  });
  assert(
    "6-duplicate-q1-resolve-rejected",
    duplicateMidCard.rejected === true,
    duplicateMidCard,
    { rejected: true },
  );
  assert(
    "6-duplicate-q1-single-event",
    (await driver.storeEvents(multiRequestId, "user-input.resolved")).length ===
      1,
    (await driver.storeEvents(multiRequestId, "user-input.resolved")).length,
    1,
  );

  // (3) Keyboard switch to Q2 and a real keyboard answer.
  await driver.clickElement(
    `document.querySelectorAll(".user-question-dot")[0]`,
    "question dot 1 (review)",
  );
  snapshot = await driver.waitForCard("dot 1 focused again", (state) =>
    Boolean(
      state.activeElement &&
      state.activeElement.role === "tab" &&
      state.activeSlideIndex === 0,
    ),
  );
  await driver.pressKey("ArrowRight", 39);
  snapshot = await driver.waitForCard(
    "q2 active via keyboard",
    (state) => state.activeSlideIndex === 1,
  );
  assert(
    "3-arrowright-switches-to-q2",
    snapshot.activeSlideIndex === 1 &&
      snapshot.dotSelected[1] === "true" &&
      snapshot.activeElement?.role === "tab",
    {
      activeSlideIndex: snapshot.activeSlideIndex,
      dotSelected: snapshot.dotSelected,
      activeElement: snapshot.activeElement,
    },
    "q2 active, its dot selected and focused",
  );
  await driver.pressKey("Tab", 9, { modifiers: 8 });
  snapshot = await driver.waitForCard(
    "roving option focused after Shift+Tab",
    (state) =>
      Boolean(state.activeElement && state.activeElement.role === "option"),
  );
  // Shift+Tab lands on whichever option holds the roving tab stop — the
  // slide's active option follows hover/focus state (a stationary pointer
  // under a reflowing slide fires real mouseenter events), so the contract
  // here is "the option list's single tabbable option", then Home pins the
  // focus deterministically to the first option.
  assert(
    "3-shift-tab-enters-option-list",
    snapshot.activeElement?.role === "option" &&
      Boolean(
        snapshot.activeOptions.find(
          (option) => option.tabIndex === 0 && option.disabled === false,
        ),
      ),
    snapshot.activeElement,
    "focus on the option list's single roving tab stop (any option, including Other…)",
  );
  await driver.pressKey("Home", 36);
  snapshot = await driver.waitForCard("Home pins first option focus", (state) =>
    Boolean(state.activeElement?.text.includes("Email digest")),
  );
  assert(
    "3-option-home-pins-first",
    snapshot.activeElement?.text.includes("Email digest") === true,
    snapshot.activeElement,
    "focus pinned on 'Email digest'",
  );
  await driver.pressKey("ArrowDown", 40);
  snapshot = await driver.waitForCard("focus on second option", (state) =>
    Boolean(state.activeElement?.text.includes("In-app banner")),
  );
  assert(
    "3-arrowdown-moves-option-focus",
    snapshot.activeElement?.text.includes("In-app banner") === true,
    snapshot.activeElement,
    "focus on 'In-app banner'",
  );
  await driver.pressKey("End", 35);
  snapshot = await driver.waitForCard("End focuses other option", (state) =>
    Boolean(state.activeElement?.text.includes("Other")),
  );
  assert(
    "3-option-end-reaches-other",
    snapshot.activeElement?.text.includes("Other") === true,
    snapshot.activeElement,
    "focus on the Other… option",
  );
  await driver.pressKey("Home", 36);
  snapshot = await driver.waitForCard("Home returns to first option", (state) =>
    Boolean(state.activeElement?.text.includes("Email digest")),
  );
  assert(
    "3-option-home-returns-first",
    snapshot.activeElement?.text.includes("Email digest") === true,
    snapshot.activeElement,
    "focus back on 'Email digest' after End",
  );
  await driver.pressKey("ArrowDown", 40);
  await driver.waitForCard("focus back on In-app banner", (state) =>
    Boolean(state.activeElement?.text.includes("In-app banner")),
  );
  await driver.pressKey("Enter", 13, { text: "\r" });
  snapshot = await driver.waitForCard(
    "progress 2/3 and slide advanced after keyboard answer",
    (state) =>
      state.progressText === "2/3 answered" && state.activeSlideIndex === 2,
  );
  assert(
    "3-progress-two-of-three",
    snapshot.progressText === "2/3 answered" && snapshot.progressNow === "2",
    { progressText: snapshot.progressText, progressNow: snapshot.progressNow },
    { progressText: "2/3 answered", progressNow: "2" },
  );
  assert(
    "3-card-advances-to-q3",
    snapshot.activeSlideIndex === 2,
    snapshot.activeSlideIndex,
    2,
  );
  resolved = await driver.storeEvents(multiRequestId, "user-input.resolved");
  assert(
    "3-resolved-q2-keyboard-user",
    resolved.length === 2 &&
      resolved[1]?.questionId === "q2" &&
      resolved[1]?.source === "user" &&
      resolved[1]?.selectedOptionLabel === "In-app banner",
    resolved,
    "two resolved events; q2 closed by keyboard with source user and label 'In-app banner'",
  );
  screenshots.push({
    name: `${testCase.caseId}-03-q2-keyboard-answered.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-03-q2-keyboard-answered.png`),
    ),
  });

  // (4) Q3 through the other-inline custom form with an IME-safe Enter.
  await driver.clickActiveOptionByLabel("Other…");
  await driver.waitForCard(
    "other-inline form open",
    (state) => state.otherFormPresent,
  );
  snapshot = await driver.cardSnapshot();
  assert(
    "4-other-form-autofocus",
    snapshot.activeElement?.tag === "INPUT",
    snapshot.activeElement,
    "the custom answer input holds focus",
  );
  await driver.insertText(customAnswer);
  snapshot = await driver.cardSnapshot();
  assert(
    "4-custom-text-typed",
    snapshot.otherInputValue === customAnswer,
    snapshot.otherInputValue,
    customAnswer,
  );
  await driver.evaluate(`(() => {
    const input = document.querySelector(
      ".user-question-slide.active .user-input-other-inline input",
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  snapshot = await driver.cardSnapshot();
  assert(
    "4-ime-composing-enter-blocked",
    snapshot.otherFormPresent === true &&
      snapshot.progressText === "2/3 answered",
    {
      otherFormPresent: snapshot.otherFormPresent,
      progressText: snapshot.progressText,
    },
    { otherFormPresent: true, progressText: "2/3 answered" },
  );
  await driver.pressKey("Enter", 13, { text: "\r" });
  snapshot = await driver.waitForCard(
    "card answered after custom submit",
    (state) => state.answered && !state.pending,
  );
  assert(
    "4-card-answered-rendered",
    snapshot.answered === true && snapshot.pending === false,
    snapshot.status,
    "user-input-card multi-question answered",
  );
  assert(
    "4-progress-three-of-three",
    snapshot.progressText === "3/3 answered" && snapshot.progressNow === "3",
    { progressText: snapshot.progressText, progressNow: snapshot.progressNow },
    { progressText: "3/3 answered", progressNow: "3" },
  );
  resolved = await driver.storeEvents(multiRequestId, "user-input.resolved");
  assert(
    "4-resolved-three-in-question-order",
    resolved.length === 3 &&
      resolved.map((event) => event.questionId).join(",") === "q1,q2,q3" &&
      resolved.every((event) => event.kind === "multi-question") &&
      resolved.every((event) => event.source === "user"),
    resolved.map((event) => ({
      questionId: event.questionId,
      kind: event.kind,
      source: event.source,
    })),
    "three kind'd resolved events in q1->q2->q3 order, each source user",
  );
  assert(
    "4-q3-custom-answer-recorded",
    resolved[2]?.customAnswer === customAnswer,
    resolved[2]?.customAnswer ?? null,
    customAnswer,
  );
  assert(
    "4-result-strips-show-answers",
    snapshot.resultStrips.length === 3 &&
      snapshot.resultStrips.some((strip) => strip.includes("Ship it")) &&
      snapshot.resultStrips.some((strip) => strip.includes("In-app banner")) &&
      snapshot.resultStrips.some((strip) => strip.includes(customAnswer)),
    snapshot.resultStrips,
    "three result strips carrying the three answers",
  );
  screenshots.push({
    name: `${testCase.caseId}-04-answered.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-04-answered.png`),
    ),
  });

  // (6b) Registry is drained: a duplicate resolve of the finished card is
  // rejected and the resolved-event count stays exactly three.
  const duplicateAfterFinal = await driver.tryResolveDuplicate("q3", {
    selectedOptionLabel: "No, keep it short",
  });
  assert(
    "6-duplicate-after-final-rejected",
    duplicateAfterFinal.rejected === true,
    duplicateAfterFinal,
    { rejected: true },
  );
  assert(
    "6-duplicate-after-final-three-events",
    (await driver.storeEvents(multiRequestId, "user-input.resolved")).length ===
      3,
    (await driver.storeEvents(multiRequestId, "user-input.resolved")).length,
    3,
  );

  // (7) Legacy single-question regression arm (the #124 smoke ⑤ checks,
  // driven through the real card UI this time).
  const legacyRequested = await driver.storeEvents(
    legacyRequestId,
    "user-input.requested",
  );
  assert(
    "7-legacy-request-persisted",
    legacyRequested.length === 1,
    legacyRequested.length,
    1,
  );
  snapshot = await driver.waitForCard(
    "legacy card still pending",
    (state) => state.legacyCards[0]?.pending === true,
  );
  assert(
    "7-legacy-card-shows-question",
    snapshot.legacyCards[0]?.question === "Run the legacy release checklist?",
    snapshot.legacyCards[0]?.question ?? null,
    "Run the legacy release checklist?",
  );
  await driver.clickElement(
    `[...document.querySelectorAll(".user-input-card:not(.multi-question) .user-input-option")].find(
      (button) => button.querySelector(".user-input-option-title strong")?.textContent === "Yes, run the checklist",
    )`,
    "legacy recommended option",
  );
  await driver.waitForCard(
    "legacy card answered",
    (state) => state.legacyCards[0]?.answered === true,
  );
  snapshot = await driver.cardSnapshot();
  assert(
    "7-legacy-card-settled-rendered",
    snapshot.legacyCards[0]?.answered === true &&
      snapshot.legacyCards[0]?.pending === false,
    snapshot.legacyCards,
    "legacy card settled as answered",
  );
  assert(
    "7-no-pending-cards-at-rest",
    (await driver.evaluate(
      "document.querySelectorAll('.user-input-card.pending').length",
    )) === 0,
    await driver.evaluate(
      "document.querySelectorAll('.user-input-card.pending').length",
    ),
    0,
  );
  const legacyResolved = await driver.storeEvents(
    legacyRequestId,
    "user-input.resolved",
  );
  assert(
    "7-legacy-resolved-once",
    legacyResolved.length === 1,
    legacyResolved.length,
    1,
  );
  assert(
    "7-legacy-resolved-answer-is-label",
    legacyResolved[0]?.answer === "Yes, run the checklist" &&
      legacyResolved[0]?.source === "user",
    legacyResolved[0],
    "one legacy resolution with the label as answer and source user",
  );
  screenshots.push({
    name: `${testCase.caseId}-05-legacy-answered.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-05-legacy-answered.png`),
    ),
  });

  // (8) 200% zoom layout pass (light round only).
  const zoomEvidence = {
    applied: false,
    presses: 0,
    ratio: 1,
    layoutIntact: false,
  };
  if (testCase.zoomArm) {
    // This app wires no zoom affordance the driver can reach (no zoom menu
    // roles or shortcuts exist — probed with real Meta+=/Shift/Numpad key
    // events — and ARTEMIS_SMOKE_SCALE requires the auto-quit smoke
    // harness and caps at 1.5), so the 200% pass applies Chromium's CSS
    // zoom property on the document element: the same layout scaling a
    // zoomFactor applies, recomputed by the real layout engine, asserted
    // through real geometry.
    const geometryProbe = `(() => {
      const card = document.querySelector(".user-input-card.multi-question");
      const dots = card?.querySelector(".user-question-dots");
      const bounds = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        // Under CSS zoom, getBoundingClientRect reports visual (zoomed)
        // pixels while offsetWidth reports unzoomed layout pixels, so the
        // quotient is the applied zoom factor.
        return {
          width: rect.width,
          right: rect.right,
          offsetWidth: element.offsetWidth,
        };
      };
      return {
        card: bounds(card),
        dots: bounds(dots),
        innerWidth: window.innerWidth,
        computedZoom: getComputedStyle(document.documentElement).zoom,
      };
    })()`;
    const baseline = await driver.evaluate(geometryProbe);
    await driver.evaluate(`document.documentElement.style.zoom = "2"; true`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await driver.waitForCard("zoomed card snapshot", () => true);
    const zoomed = await driver.evaluate(geometryProbe);
    zoomEvidence.presses = 0;
    zoomEvidence.ratio =
      Math.round(
        ((zoomed.card?.width ?? 0) / (zoomed.card?.offsetWidth ?? 1)) * 100,
      ) / 100;
    zoomEvidence.applied =
      zoomed.computedZoom === "2" &&
      zoomEvidence.ratio >= 1.9 &&
      zoomEvidence.ratio <= 2.1;
    zoomEvidence.layoutIntact =
      zoomEvidence.applied === true &&
      (zoomed.card?.right ?? Number.POSITIVE_INFINITY) <=
        zoomed.innerWidth + 2 &&
      (zoomed.dots?.right ?? Number.POSITIVE_INFINITY) <=
        zoomed.innerWidth + 2 &&
      snapshot.slideCount === 3 &&
      snapshot.dotCount === 3;
    assert(
      "8-zoom-reached-200-percent",
      zoomEvidence.applied === true,
      {
        ratio: zoomEvidence.ratio,
        computedZoom: zoomed.computedZoom,
        zoomedCardWidth: zoomed.card?.width,
        zoomedCardOffsetWidth: zoomed.card?.offsetWidth,
        baselineComputedZoom: baseline.computedZoom,
      },
      { computedZoom: "2", ratio: "1.9 - 2.1 (CSS zoom 2 applied)" },
    );
    assert(
      "8-zoom-layout-intact",
      zoomEvidence.layoutIntact === true,
      {
        cardRight: zoomed.card?.right,
        dotsRight: zoomed.dots?.right,
        innerWidth: zoomed.innerWidth,
        slideCount: snapshot.slideCount,
        dotCount: snapshot.dotCount,
      },
      "card and dots stay inside the viewport with three slides and three dots intact",
    );
    screenshots.push({
      name: `${testCase.caseId}-06-zoom200.png`,
      bytes: await driver.screenshot(
        artifactsFor(`${testCase.caseId}-06-zoom200.png`),
      ),
    });
    await driver.evaluate(`document.documentElement.style.zoom = ""; true`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const reset = await driver.evaluate(geometryProbe);
    assert(
      "8-zoom-reset-restores-geometry",
      reset.computedZoom === baseline.computedZoom &&
        Math.abs(
          (reset.card?.width ?? 0) / (reset.card?.offsetWidth ?? 1) - 1,
        ) <= 0.05,
      {
        resetComputedZoom: reset.computedZoom,
        resetRatio:
          Math.round(
            ((reset.card?.width ?? 0) / (reset.card?.offsetWidth ?? 1)) * 100,
          ) / 100,
        baselineCardWidth: baseline.card?.width,
      },
      "zoom factor 1 restored after resetting the CSS zoom",
    );
  }

  const keyboardContract = {
    questionLevel: {
      keysPressed: ["ArrowRight x2", "Home", "End"],
      rovingSingleTabStop: true,
      focusFollowsDot: true,
      navigation: "ArrowRight moves selection and focus; Home/End jump",
    },
    optionLevel: {
      entry:
        "Shift+Tab from the focused dot lands on the roving (tabIndex 0) option",
      keysPressed: ["ArrowDown", "End", "Home"],
      activation: "Enter keyDown(\\r)+keyUp activates the focused option",
    },
    focusIn: "real mouse click focuses a dot; Shift+Tab enters the option list",
    ime: {
      textEntry: "CDP Input.insertText (IME-commit equivalent)",
      composingEnterBlocked: true,
      plainEnterSubmitted: true,
    },
  };

  return {
    requestedQuestions,
    resolvedEvents: await driver.storeEvents(
      multiRequestId,
      "user-input.resolved",
    ),
    legacyResolved: await driver.storeEvents(
      legacyRequestId,
      "user-input.resolved",
    ),
    screenshots,
    zoomEvidence,
    keyboardContract,
    driveAssertions,
  };
}

async function driveExpiredArm(driver, testCase, artifactsFor) {
  const { assertions: driveAssertions, assert } = makeAssertions(
    testCase.caseId,
  );
  const screenshots = [];
  await driver.waitForElement(
    `document.querySelector(".thread-select")`,
    "thread selector",
    20_000,
  );
  await driver.clickElement(
    `document.querySelector(".thread-select")`,
    "thread select",
  );
  await driver.waitForCard(
    "expired card pending",
    (snapshot) => snapshot.pending && snapshot.slideCount === 2,
    20_000,
  );
  // (5) The already-expired first question resolved through the timer's own
  // resolution function: recommended label, source timeout, exactly one.
  let resolved = await driver.storeEvents(
    expiredRequestId,
    "user-input.resolved",
  );
  assert(
    "5-timeout-resolved-exactly-one",
    resolved.length === 1,
    resolved.length,
    1,
  );
  assert(
    "5-timeout-source-and-question",
    resolved[0]?.kind === "multi-question" &&
      resolved[0]?.questionId === "e1" &&
      resolved[0]?.source === "timeout",
    resolved[0],
    "one kind'd resolved event for e1 with source timeout",
  );
  assert(
    "5-timeout-answer-is-recommended-label",
    resolved[0]?.selectedOptionLabel === "Archive it",
    resolved[0]?.selectedOptionLabel ?? null,
    "Archive it",
  );
  let snapshot = await driver.waitForCard(
    "card still pending after partial timeout",
    (state) => state.pending,
  );
  assert(
    "5-card-still-pending",
    snapshot.pending === true,
    snapshot.status,
    "card still pending after the e1 timeout",
  );
  assert(
    "5-progress-one-of-two",
    snapshot.progressText === "1/2 answered" && snapshot.progressNow === "1",
    { progressText: snapshot.progressText, progressNow: snapshot.progressNow },
    { progressText: "1/2 answered", progressNow: "1" },
  );
  assert(
    "5-e2-unaffected-active",
    snapshot.activeSlideIndex === 1 &&
      snapshot.slideTexts[1]?.includes("File the report where?") === true,
    {
      activeSlideIndex: snapshot.activeSlideIndex,
      slideTexts: snapshot.slideTexts,
    },
    "the live second question is the active, answerable slide",
  );
  const requested = await driver.storeEvents(
    expiredRequestId,
    "user-input.requested",
  );
  const e2Deadline = requested[0]?.questions?.[1]?.expiresAt ?? null;
  assert(
    "5-live-question-keeps-own-deadline",
    snapshot.timeDateTime === e2Deadline &&
      Number.isFinite(Date.parse(e2Deadline ?? "")),
    snapshot.timeDateTime,
    e2Deadline,
  );
  // Reviewing the expired question clamps its countdown to 0:00.
  await driver.clickElement(
    `document.querySelectorAll(".user-question-dot")[0]`,
    "expired question dot",
  );
  snapshot = await driver.waitForCard(
    "expired question reviewed",
    (state) => state.activeSlideIndex === 0,
  );
  assert(
    "5-expired-countdown-clamped",
    snapshot.timeText === "0:00",
    snapshot.timeText,
    "0:00",
  );
  screenshots.push({
    name: `${testCase.caseId}-01-after-timeout.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-01-after-timeout.png`),
    ),
  });
  // The live question stays answerable by hand; the card then settles as a
  // mixed timed-out aggregate (any timed-out question -> timed-out card).
  await driver.clickElement(
    `document.querySelectorAll(".user-question-dot")[1]`,
    "live question dot",
  );
  await driver.waitForCard(
    "live question active",
    (state) => state.activeSlideIndex === 1,
  );
  await driver.clickActiveOptionByLabel("Email digest");
  snapshot = await driver.waitForCard(
    "mixed card settled timed-out",
    (state) => state.timedOut && !state.pending,
  );
  resolved = await driver.storeEvents(expiredRequestId, "user-input.resolved");
  assert(
    "5-mixed-both-questions-resolved",
    resolved.length === 2 &&
      resolved[0]?.source === "timeout" &&
      resolved[1]?.source === "user" &&
      resolved[1]?.selectedOptionLabel === "Email digest",
    resolved,
    "e1 timeout + e2 user, per-question provenance preserved",
  );
  assert(
    "5-mixed-card-settles-timed-out",
    snapshot.timedOut === true && snapshot.pending === false,
    snapshot.status,
    "aggregate card settles timed-out",
  );
  assert(
    "5-mixed-result-strips",
    snapshot.resultStrips.some((strip) => strip.includes("Archive it")) &&
      snapshot.resultStrips.some((strip) => strip.includes("Email digest")),
    snapshot.resultStrips,
    "result strips carry the timed-out recommendation and the user choice",
  );
  screenshots.push({
    name: `${testCase.caseId}-02-mixed-settled.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-02-mixed-settled.png`),
    ),
  });
  return { resolvedEvents: resolved, screenshots, driveAssertions };
}

async function driveCancelArm(driver, testCase, artifactsFor) {
  const { assertions: driveAssertions, assert } = makeAssertions(
    testCase.caseId,
  );
  const screenshots = [];
  await driver.waitForElement(
    `document.querySelector(".thread-select")`,
    "thread selector",
    20_000,
  );
  await driver.clickElement(
    `document.querySelector(".thread-select")`,
    "thread select",
  );
  await driver.waitForCard(
    "cancel-target card pending",
    (snapshot) => snapshot.pending && snapshot.slideCount === 2,
    20_000,
  );
  let snapshot = await driver.cardSnapshot();
  assert(
    "6-cancel-target-pending",
    snapshot.pending === true && snapshot.progressText === "0/2 answered",
    { pending: snapshot.pending, progressText: snapshot.progressText },
    { pending: true, progressText: "0/2 answered" },
  );
  const cancelOutcome = await driver.evaluate(
    `window.artemis.cancelTurn(${JSON.stringify(threadId)}).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }),
    )`,
  );
  assert("6-cancel-turn-invoked", cancelOutcome.ok === true, cancelOutcome, {
    ok: true,
  });
  const resolved = await driver.storeEvents(
    cancelRequestId,
    "user-input.resolved",
  );
  assert(
    "6-cancel-one-kindless-cancelled",
    resolved.length === 1 &&
      resolved[0]?.kind === undefined &&
      resolved[0]?.source === "cancelled",
    resolved,
    "exactly one kind-less resolved event with source cancelled",
  );
  snapshot = await driver.waitForCard(
    "card cancelled",
    (state) => state.cancelled && !state.pending,
  );
  assert(
    "6-cancel-closes-whole-card",
    snapshot.cancelled === true && snapshot.pending === false,
    snapshot.status,
    "whole card renders cancelled",
  );
  const drainedProbe = await driver.evaluate(
    `window.artemis.resolveUserInput(${JSON.stringify({
      requestId: cancelRequestId,
      nonce: "artemis-smoke-multi-ui-cancel-nonce",
      kind: "multi-question",
      questionId: "c1",
      selectedOptionLabel: "Staged rollout",
    })}).then(() => ({ rejected: false }), (error) => ({
      rejected: true,
      message: error instanceof Error ? error.message : String(error),
    }))`,
  );
  assert(
    "6-cancel-registry-drained",
    drainedProbe.rejected === true,
    drainedProbe,
    { rejected: true },
  );
  screenshots.push({
    name: `${testCase.caseId}-01-cancelled.png`,
    bytes: await driver.screenshot(
      artifactsFor(`${testCase.caseId}-01-cancelled.png`),
    ),
  });
  return {
    resolvedEvents: resolved,
    screenshots,
    cancelOutcome,
    driveAssertions,
  };
}

const driveByView = {
  "multi-question-ui": driveMainFlow,
  "multi-question-ui-expired": driveExpiredArm,
  "multi-question-ui-cancel": driveCancelArm,
};

await mkdir(outputDirectory, { recursive: true });
let driverExitCode = 0;
try {
  for (const testCase of cases) {
    const { caseId, view, theme } = testCase;
    const artifactsFor = (name) => join(outputDirectory, name);
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
    };
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves
    // 127.0.0.1. No ARTEMIS_SMOKE_SCREENSHOT/ACCESSIBILITY either: this
    // driver keeps the app alive and connects over the remote-debugging
    // port, so the harness's own screenshot-and-quit path must not arm.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ARTEMIS_SMOKE_SCREENSHOT;
    delete environment.ARTEMIS_SMOKE_ACCESSIBILITY;
    const attemptDrive = async (attempt) =>
      launchAndDrive(caseId, attempt, environment, (driver) =>
        driveByView[view](driver, testCase, artifactsFor),
      );
    let outcome;
    let output = "";
    try {
      outcome = await attemptDrive(0);
      output = outcome.output;
    } catch (error) {
      if (process.env.CI) throw error;
      console.log(
        `RETRY ${caseId} after failure: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      );
      const retry = await attemptDrive(1);
      outcome = retry;
      output = retry.output;
    }
    const { assertions, assert } = makeAssertions(caseId);
    // Isolation gates follow the #117 standard: the winning launch started
    // from a user-data directory that did not exist yet, the throwaway run
    // root only ever holds the user-data subtree, and no captured audit
    // data leaks a local path (checked once over the final report below).
    assert(
      "9-user-data-fresh-start",
      outcome.userDataPreexisting === false,
      outcome.userDataPreexisting,
      false,
    );
    const unexpectedRunRootEntries = (await readdir(temporaryDirectory))
      .sort()
      .filter((entry) => entry !== "user-data");
    assert(
      "9-run-root-purity",
      unexpectedRunRootEntries.length === 0,
      unexpectedRunRootEntries,
      [],
    );
    for (const shot of outcome.outcome.screenshots) {
      assert(
        `9-screenshot-not-empty:${shot.name}`,
        shot.bytes > 10_000,
        shot.bytes,
        "> 10000 bytes",
      );
    }
    results.push({
      caseId,
      view,
      theme,
      scenario: testCase.scenario,
      screenshots: outcome.outcome.screenshots,
      resolvedEvents: outcome.outcome.resolvedEvents ?? [],
      legacyResolved: outcome.outcome.legacyResolved ?? null,
      zoomEvidence: outcome.outcome.zoomEvidence ?? null,
      keyboardContract: outcome.outcome.keyboardContract ?? null,
      electronTeardown: outcome.teardown ?? null,
      assertions: [...(outcome.outcome.driveAssertions ?? []), ...assertions],
    });
    const assertionCount =
      (outcome.outcome.driveAssertions?.length ?? 0) + assertions.length;
    console.log(
      `PASS ${caseId} (${assertionCount} assertions, ${outcome.outcome.screenshots.length} screenshots)`,
    );
  }

  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const auditReport = {
    format: "artemis-user-input-multi-ui-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    method: {
      driver:
        "Real UI operations over the DevTools protocol: every answer, navigation, and activation is a CDP Input-level mouse press or key event against the built production renderer; store evidence is read back through the renderer's own window.artemis.getThreadEvents IPC.",
      seeding:
        "main.ts contributes only the ARTEMIS_SMOKE_VIEW=multi-question-ui* seeding gate: a real pendingMultiUserInputs registration plus a real user-input.requested payload through emitPayload (the #124 smoke channel), the legacy regression card through the real handleUserInputBrokerRequest, and per-view arms for the already-expired question and the cancel target.",
      timeoutDrive:
        "The five-minute per-question timers cannot be shortened, so the timeout arm seeds the first question with an already-past deadline and closes it through the timer's own resolution function (completeMultiUserInputQuestion, source 'timeout') — the same disclosed fallback as the #124 checklist §6-2.",
      cancelDrive:
        "Cancellation drives the renderer's own cancelTurn IPC (the real cancelTaskTurn path).",
      brokerObservability:
        "The single aggregated broker.resolve per finished card is posted by completeMultiUserInputQuestion inside the main process and is silently dropped by the real agent host for the synthetic worker ids, so it is not externally observable from this driver; the #124 transport smoke (verify-user-input-transport) already pinned exactly-once backfills with in-main capture. This run asserts the externally observable equivalents: exactly one kind'd resolved event per question in q1->q2->q3 order, duplicate resolutions rejected with the event count unchanged, registry drained, and the aggregate card state rendered.",
      zeroDialOut:
        "No provider, endpoint, or network resource is dialed; every identity (project, thread, turn, request ids, nonces, worker ids) is synthetic and reserved.",
    },
    isolation: {
      userData:
        "user-data/user-input-multi-ui/<caseId>-attempt-<attempt> under the throwaway run root; the winning launch always started from a directory that did not exist yet",
      runRootPurity: "verified per case",
      devServer:
        "ARTEMIS_DEV_SERVER_URL and ELECTRON_RUN_AS_NODE deleted from the environment; ARTEMIS_SMOKE_SCREENSHOT/ACCESSIBILITY never set so the built-in harness quit path stays disarmed while this driver owns the app lifetime",
    },
    summary: {
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
      screenshots: results.reduce(
        (sum, result) => sum + result.screenshots.length,
        0,
      ),
    },
    results,
  };
  const serializedAudit = JSON.stringify(auditReport);
  const localPathMarkers = [
    appDirectory,
    repositoryRoot,
    temporaryDirectory,
    tmpdir(),
    homedir(),
  ].filter(Boolean);
  const leakedMarker = localPathMarkers.find((marker) =>
    serializedAudit.includes(marker),
  );
  if (leakedMarker) {
    throw new Error(`Audit data leaked a local path: ${leakedMarker}`);
  }
  const auditPath = join(outputDirectory, "report.json");
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `User input multi-question UI smoke passed: ${results.length} cases, ${totalAssertions} assertions, ${auditReport.summary.screenshots} screenshots.`,
  );
  const keySequence = results
    .filter((result) => result.caseId.startsWith("multi-ui-flow"))
    .map((result) => result.resolvedEvents.map((event) => event.questionId));
  console.log(
    `Q1->Q2->Q3 resolved sequence per flow case: ${keySequence
      .map((sequence) => sequence.join("->"))
      .join(" | ")}`,
  );
  console.log(auditPath);
} catch (error) {
  driverExitCode = 1;
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
  // The driver must not linger on inherited grandchild pipes (the runtime
  // bootstrap spawns download helpers per fresh user-data): every case
  // verdict and artifact is already on disk at this point, and the exit
  // code still reflects the outcome.
  process.exit(driverExitCode);
}
