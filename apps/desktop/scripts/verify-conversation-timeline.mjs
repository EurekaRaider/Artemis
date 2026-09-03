import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
    join(repositoryRoot, "artifacts", "conversation-timeline"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-conversation-timeline-"),
);

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Conversation verifier could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
if (!/^[0-9a-f]{40}$/u.test(candidateHead) || expectedHead !== candidateHead) {
  throw new Error(
    `Conversation verifier expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
  );
}
const initialStatus = runGit(["status", "--porcelain"]);
if (initialStatus !== "") {
  throw new Error(
    `Conversation verification requires a clean exact-head worktree:\n${initialStatus}`,
  );
}

const cases = [
  {
    caseId: "rich-light-ltr",
    direction: "ltr",
    reducedMotion: false,
    scale: 1,
    theme: "light",
    view: "conversation-timeline-rich",
    width: 1_440,
  },
  {
    caseId: "rich-dark-rtl-200",
    direction: "rtl",
    reducedMotion: true,
    scale: 2,
    theme: "dark",
    view: "conversation-timeline-rich",
    width: 1_100,
  },
  {
    caseId: "failed-dark-ltr",
    direction: "ltr",
    reducedMotion: false,
    scale: 1,
    theme: "dark",
    view: "conversation-timeline-failed",
    width: 1_100,
  },
  {
    caseId: "empty-light-ltr",
    direction: "ltr",
    reducedMotion: false,
    scale: 1,
    theme: "light",
    view: "conversation-timeline-empty",
    width: 1_100,
  },
];

const results = [];
await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const screenshotPath = join(outputDirectory, `${testCase.caseId}.png`);
    const accessibilityPath = join(
      outputDirectory,
      `${testCase.caseId}.a11y.json`,
    );
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const userDataDirectory = join(
      temporaryDirectory,
      "user-data",
      testCase.caseId,
    );
    const userDataPreexisting = existsSync(userDataDirectory);
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_DIRECTION: testCase.direction,
      ARTEMIS_SMOKE_LOCALE: "en",
      ARTEMIS_SMOKE_SCALE: String(testCase.scale),
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_SETTLE_DELAY: "650",
      ARTEMIS_SMOKE_THEME: testCase.theme,
      ARTEMIS_SMOKE_VIEW: testCase.view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(testCase.width),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    const electronArguments = [
      appDirectory,
      `--user-data-dir=${userDataDirectory}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
      ...(testCase.reducedMotion
        ? ["--force-prefers-reduced-motion"]
        : ["--force-prefers-no-reduced-motion"]),
    ];
    const launchResult = spawnSync(electronPath, electronArguments, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 90_000,
    });
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Conversation smoke case ${testCase.caseId} failed.`,
          `status=${String(launchResult.status)} signal=${String(launchResult.signal)}`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const screenshotBytes = (await stat(screenshotPath)).size;
    const timeline = audit.conversationTimeline;
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const assertion = { name, pass, actual, expected };
      assertions.push(assertion);
      if (!pass) {
        throw new Error(
          `${testCase.caseId} assertion failed: ${name}; actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
        );
      }
    };
    const components = (component) =>
      timeline?.components?.filter(
        (candidate) => candidate.component === component,
      ) ?? [];
    const states = (component) =>
      new Set(components(component).map((candidate) => candidate.state));

    assert("user-data-fresh-start", !userDataPreexisting, false, false);
    assert(
      "renderer-sandbox-launch-flag",
      !electronArguments.includes("--no-sandbox"),
      electronArguments,
      "no --no-sandbox",
    );
    assert(
      "screenshot-not-empty",
      screenshotBytes > 10_000,
      screenshotBytes,
      "> 10000 bytes",
    );
    assert(
      "document-identity",
      audit.title === "Artemis" && audit.documentLanguage === "en",
      { title: audit.title, language: audit.documentLanguage },
      { title: "Artemis", language: "en" },
    );
    assert(
      "audit-issues-empty",
      Array.isArray(audit.issues) && audit.issues.length === 0,
      audit.issues,
      [],
    );
    assert(
      "renderer-runtime-security",
      audit.runtimeSecurity?.sandbox === true &&
        audit.runtimeSecurity?.contextIsolation === true &&
        audit.runtimeSecurity?.nodeIntegration === false,
      audit.runtimeSecurity ?? null,
      { sandbox: true, contextIsolation: true, nodeIntegration: false },
    );
    assert(
      "renderer-console-clean",
      Array.isArray(audit.rendererConsoleEntries) &&
        audit.rendererConsoleEntries.length === 0,
      audit.rendererConsoleEntries ?? null,
      [],
    );
    assert(
      "conversation-audit-present",
      timeline?.view === testCase.view,
      timeline?.view ?? null,
      testCase.view,
    );
    assert(
      "direction",
      timeline?.direction === testCase.direction,
      timeline?.direction ?? null,
      testCase.direction,
    );
    assert(
      "thinking-hidden",
      timeline?.thinkingLeak === false,
      timeline?.thinkingLeak ?? null,
      false,
    );
    assert(
      "conversation-landmarks",
      components("conversation-surface")[0]?.ariaLabel === "Conversation" &&
        components("timeline-viewport")[0]?.ariaLabel ===
          "Conversation history",
      {
        conversation: components("conversation-surface")[0]?.ariaLabel,
        timeline: components("timeline-viewport")[0]?.ariaLabel,
      },
      { conversation: "Conversation", timeline: "Conversation history" },
    );
    assert(
      "timeline-inline-fit",
      timeline?.timelineFitsViewport === true &&
        Array.isArray(timeline?.horizontalOverflow) &&
        timeline.horizontalOverflow.length === 0,
      timeline?.horizontalOverflow ?? null,
      [],
    );
    assert(
      "viewport-scroll-contract",
      timeline?.viewport?.overflowY === "auto" &&
        timeline.viewport.scrollWidth <= timeline.viewport.clientWidth + 1,
      timeline?.viewport ?? null,
      "vertical auto scroll without horizontal overflow",
    );

    if (testCase.view === "conversation-timeline-rich") {
      for (const component of [
        "conversation-surface",
        "timeline-viewport",
        "timeline",
        "timeline-turn",
        "conversation-message",
        "turn-execution-disclosure",
        "turn-change-summary",
        "queued-message-group",
        "queued-message-item",
        "tool-activity",
        "task-plan",
        "user-input",
        "agent-activity",
        "turn-status",
      ]) {
        assert(
          `rich-component-${component}`,
          (timeline.componentCounts?.[component] ?? 0) > 0,
          timeline.componentCounts?.[component] ?? 0,
          "> 0",
        );
      }
      const messageKinds = new Set(
        components("conversation-message").map(
          (component) => component.messageKind,
        ),
      );
      assert(
        "message-kinds",
        ["user", "assistant", "steering"].every((kind) =>
          messageKinds.has(kind),
        ),
        [...messageKinds],
        ["user", "assistant", "steering"],
      );
      assert(
        "turn-states",
        ["completed", "cancelled", "running"].every((state) =>
          states("timeline-turn").has(state),
        ),
        [...states("timeline-turn")],
        ["completed", "cancelled", "running"],
      );
      assert(
        "tool-states",
        ["completed", "failed", "running"].every((state) =>
          states("tool-activity").has(state),
        ),
        [...states("tool-activity")],
        ["completed", "failed", "running"],
      );
      assert(
        "native-interactive-agent",
        components("agent-activity").some(
          (component) => component.tagName === "button",
        ),
        components("agent-activity").map((component) => component.tagName),
        "button",
      );
      assert(
        "completed-disclosure-opened",
        timeline.interaction?.disclosureOpened === true,
        timeline.interaction,
        "native details opened",
      );
      assert(
        "pinned-resize-stays-at-bottom",
        Math.abs(timeline.interaction?.bottomDistanceBefore ?? 99) <= 2 &&
          Math.abs(timeline.interaction?.bottomDistanceAfter ?? 99) <= 2,
        timeline.interaction,
        "bottom distances <= 2px",
      );
      assert(
        "message-action-keyboard-visible",
        Number(timeline.interaction?.actionOpacity) >= 0.99,
        timeline.interaction?.actionOpacity,
        ">= 0.99",
      );
      assert(
        "child-agent-activation",
        timeline.interaction?.childPanelOpened === true,
        timeline.interaction?.childPanelOpened,
        true,
      );
      assert(
        "user-input-keyboard-focus",
        timeline.interaction?.inputFocused === true,
        timeline.interaction?.inputFocused,
        true,
      );
      assert(
        "long-content-scrollable",
        timeline.viewport.clientHeight >= 48 &&
          timeline.viewport.scrollHeight > timeline.viewport.clientHeight,
        timeline.viewport,
        "clientHeight >= 48 and scrollHeight > clientHeight",
      );
      const minimumVisibleMessagePixels =
        20 - 1 / Math.max(1, Number(timeline.devicePixelRatio) || 1);
      assert(
        "conversation-message-visible",
        timeline.visibleMessageCount > 0 &&
          timeline.visibleMessagePixels >= minimumVisibleMessagePixels,
        {
          count: timeline.visibleMessageCount,
          pixels: timeline.visibleMessagePixels,
          minimum: minimumVisibleMessagePixels,
        },
        "at least one message within one device pixel of 20 visible CSS px",
      );
      assert(
        "user-message-inline-end-alignment",
        timeline.inlineEndGap !== null &&
          timeline.inlineEndGap >= 0 &&
          timeline.inlineEndGap <= 24,
        timeline.inlineEndGap,
        "0..24 CSS px",
      );
      assert(
        "queue-editor-closed-after-render",
        timeline.queueEditorPresent === false,
        timeline.queueEditorPresent,
        false,
      );
      assert(
        "cancelled-message-edit-action-present",
        timeline.messageActionCount >= 4,
        timeline.messageActionCount,
        ">= 4",
      );
      if (testCase.scale === 2) {
        assert(
          "two-hundred-percent-scale",
          timeline.devicePixelRatio >= 1.9,
          timeline.devicePixelRatio,
          ">= 1.9",
        );
      }
    } else if (testCase.view === "conversation-timeline-failed") {
      assert(
        "failed-turn-state",
        states("timeline-turn").has("failed"),
        [...states("timeline-turn")],
        ["failed"],
      );
      assert(
        "failed-status-visible",
        components("turn-status").some(
          (component) => component.state === "failed",
        ),
        components("turn-status"),
        "visible failed status",
      );
    } else {
      assert(
        "empty-state-visible",
        timeline.componentCounts?.["conversation-empty-state"] === 1 &&
          timeline.componentCounts?.["conversation-message"] === 0,
        timeline.componentCounts,
        { "conversation-empty-state": 1, "conversation-message": 0 },
      );
    }

    const serializedAudit = JSON.stringify(audit);
    const leakedMarkers = [
      appDirectory,
      repositoryRoot,
      temporaryDirectory,
      homedir(),
    ].filter((marker) => marker.length > 1);
    assert(
      "no-private-paths",
      leakedMarkers.every((marker) => !serializedAudit.includes(marker)),
      "redacted audit",
      "no local paths",
    );
    results.push({
      caseId: testCase.caseId,
      assertions,
      screenshotBytes,
      screenshot: screenshotPath,
      accessibility: accessibilityPath,
    });
  }

  const finalStatus = runGit(["status", "--porcelain"]);
  if (finalStatus !== initialStatus) {
    throw new Error(
      `Conversation verification changed tracked worktree state:\n${finalStatus}`,
    );
  }
  await writeFile(
    join(outputDirectory, "verification.json"),
    `${JSON.stringify({ head: candidateHead, cases: results }, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Conversation timeline verification passed (${cases.length} Electron cases; exact HEAD ${candidateHead}).`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
