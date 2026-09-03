import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
    join(repositoryRoot, "artifacts", "workspace-dock"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-workspace-dock-"),
);

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Workspace Dock verifier could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function approximatelyEqual(left, right, tolerance = 1) {
  return Math.abs(left - right) <= tolerance;
}

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
if (!/^[0-9a-f]{40}$/u.test(candidateHead) || expectedHead !== candidateHead) {
  throw new Error(
    `Workspace Dock verifier expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
  );
}
const initialStatus = runGit(["status", "--porcelain"]);
if (initialStatus !== "") {
  throw new Error(
    `Workspace Dock verification requires a clean exact-head worktree:\n${initialStatus}`,
  );
}

const cases = [
  {
    caseId: "wide-light-100",
    direction: "ltr",
    layout: "resizable",
    locale: "en",
    scale: 1,
    theme: "light",
    width: 1_440,
  },
  {
    caseId: "compact-dark-200",
    direction: "ltr",
    layout: "overlay",
    locale: "en",
    scale: 2,
    theme: "dark",
    width: 1_600,
  },
  {
    caseId: "wide-dark-rtl-100",
    direction: "rtl",
    layout: "resizable",
    locale: "ar",
    scale: 1,
    theme: "dark",
    width: 1_440,
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
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: testCase.locale,
      ARTEMIS_SMOKE_SCALE: String(testCase.scale),
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_SETTLE_DELAY: "650",
      ARTEMIS_SMOKE_THEME: testCase.theme,
      ARTEMIS_SMOKE_VIEW: "environment-dock-workspace",
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(testCase.width),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    const electronArguments = [
      appDirectory,
      `--user-data-dir=${join(
        temporaryDirectory,
        "user-data",
        testCase.caseId,
      )}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
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
          `Workspace Dock smoke case ${testCase.caseId} failed.`,
          `status=${String(launchResult.status)} signal=${String(launchResult.signal)}`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const screenshotBytes = (await stat(screenshotPath)).size;
    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const interaction = audit.workspaceDockInteraction;
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
    const assertOpenGeometry = (name, snapshot) => {
      assert(
        `${name}-dock-open`,
        snapshot?.dock?.state === "open" && snapshot.dock.visible === true,
        snapshot?.dock ?? null,
        { state: "open", visible: true },
      );
      assert(
        `${name}-resizer-semantic-contract`,
        snapshot?.resizer?.role === "separator" &&
          snapshot.resizer.state === "open" &&
          snapshot.resizer.value >= snapshot.resizer.minimum &&
          snapshot.resizer.value <= snapshot.resizer.maximum &&
          typeof snapshot.resizer.label === "string" &&
          snapshot.resizer.label.length > 0 &&
          typeof snapshot.resizer.valueText === "string" &&
          snapshot.resizer.valueText.endsWith(`: ${snapshot.resizer.value}px`),
        snapshot?.resizer ?? null,
        "open vertical separator with a clamped labelled pixel value",
      );
      assert(
        `${name}-conversation-minimum`,
        snapshot?.conversation?.width >= 320,
        snapshot?.conversation?.width ?? null,
        ">= 320",
      );
      assert(
        `${name}-viewport-evidence`,
        Number.isFinite(snapshot?.viewport?.innerWidth) &&
          snapshot.viewport.innerWidth > 0 &&
          Number.isFinite(snapshot.viewport.outerWidth) &&
          snapshot.viewport.outerWidth > 0 &&
          Number.isFinite(snapshot.viewport.devicePixelRatio) &&
          snapshot.viewport.devicePixelRatio > 0,
        snapshot?.viewport ?? null,
        "positive inner/outer width and device pixel ratio",
      );
      if (testCase.layout === "overlay") {
        assert(
          `${name}-compact-overlay-contract`,
          snapshot?.viewport?.compactMedia === true &&
            snapshot.viewport.innerWidth <= 820 &&
            snapshot?.resizer?.display === "none" &&
            snapshot.resizer.width === 0 &&
            approximatelyEqual(
              snapshot?.dock?.width,
              snapshot?.workspaceContent?.width,
            ),
          {
            dockWidth: snapshot?.dock?.width ?? null,
            resizer: snapshot?.resizer ?? null,
            viewport: snapshot?.viewport ?? null,
            workspaceWidth: snapshot?.workspaceContent?.width ?? null,
          },
          "<=820px overlay Dock spanning the workspace with hidden resizer",
        );
        return;
      }
      assert(
        `${name}-resizer-pixel-geometry`,
        snapshot?.viewport?.compactMedia === false &&
          snapshot?.resizer?.display !== "none" &&
          snapshot?.resizer?.visibility !== "hidden" &&
          snapshot?.resizer?.width > 0 &&
          approximatelyEqual(snapshot.resizer.value, snapshot.dock.width),
        {
          dockWidth: snapshot?.dock?.width ?? null,
          resizer: snapshot?.resizer ?? null,
          viewport: snapshot?.viewport ?? null,
        },
        "visible separator matching the Dock width outside compact media",
      );
      assert(
        `${name}-scrollbar-boundary`,
        snapshot?.direction === "rtl"
          ? approximatelyEqual(
              snapshot?.timeline?.left,
              snapshot?.resizer?.right,
            )
          : approximatelyEqual(
              snapshot?.timeline?.right,
              snapshot?.resizer?.left,
            ),
        {
          direction: snapshot?.direction ?? null,
          timelineLeft: snapshot?.timeline?.left ?? null,
          timelineRight: snapshot?.timeline?.right ?? null,
          resizerLeft: snapshot?.resizer?.left ?? null,
          resizerRight: snapshot?.resizer?.right ?? null,
        },
        "within 1px",
      );
    };

    assert(
      "screenshot-not-empty",
      screenshotBytes > 10_000,
      screenshotBytes,
      "> 10000",
    );
    assert(
      "accessibility-issues-empty",
      audit.issues?.length === 0,
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
      "renderer-sandbox-launch-flag",
      !electronArguments.includes("--no-sandbox"),
      electronArguments,
      "no --no-sandbox",
    );
    assert(
      "browser-webview-security",
      audit.browserWebviewSecurity?.allowRunningInsecureContent === false &&
        audit.browserWebviewSecurity?.attached === true &&
        audit.browserWebviewSecurity?.contextIsolation === true &&
        audit.browserWebviewSecurity?.guestType === "webview" &&
        audit.browserWebviewSecurity?.navigationAllowed === true &&
        audit.browserWebviewSecurity?.nodeIntegration === false &&
        audit.browserWebviewSecurity?.nodeIntegrationInSubFrames === false &&
        audit.browserWebviewSecurity?.partition === "persist:artemis-browser" &&
        audit.browserWebviewSecurity?.preloadPresent === false &&
        audit.browserWebviewSecurity?.sandbox === true &&
        audit.browserWebviewSecurity?.webSecurity === true,
      audit.browserWebviewSecurity ?? null,
      "attached isolated Artemis Browser webview",
    );
    assert(
      "interaction-present",
      interaction !== null && typeof interaction === "object",
      interaction,
      "workspace interaction audit",
    );
    assert(
      "responsive-layout-mode",
      interaction.layout === testCase.layout,
      interaction.layout,
      testCase.layout,
    );
    assert(
      "logical-direction",
      interaction.initial.direction === testCase.direction,
      interaction.initial.direction,
      testCase.direction,
    );
    assertOpenGeometry("initial", interaction.initial);
    assert(
      "empty-launcher-four-actions",
      interaction.initial.launcherActions === 4 &&
        interaction.initial.tabs.length === 0,
      {
        launcherActions: interaction.initial.launcherActions,
        tabs: interaction.initial.tabs,
      },
      { launcherActions: 4, tabs: [] },
    );
    assertOpenGeometry("multi-tab", interaction.multiTab);
    assert(
      "multi-tab-roving-selection",
      interaction.multiTab.tabs.length === 2 &&
        interaction.multiTab.tabs.filter((tab) => tab.active).length === 1 &&
        interaction.multiTab.tabs.filter((tab) => tab.selected === "true")
          .length === 1 &&
        interaction.multiTab.tabs.filter((tab) => tab.tabIndex === 0).length ===
          1 &&
        interaction.multiTab.tabs.every((tab) => tab.closeLabel),
      interaction.multiTab.tabs,
      "two closable tabs with one active roving target",
    );
    assertOpenGeometry("after-close", interaction.afterClose);
    assert(
      "close-focus-transfer",
      interaction.afterClose.tabs.length === 1 &&
        interaction.afterClose.tabs[0].active === true &&
        interaction.afterClose.tabs[0].selected === "true" &&
        interaction.afterClose.tabs[0].tabIndex === 0 &&
        interaction.afterClose.tabs[0].selectFocused === true,
      interaction.afterClose.tabs,
      "remaining tab active and focused",
    );
    assert(
      "browser-public-anatomy",
      interaction.afterClose.browser?.markersComplete === true &&
        interaction.afterClose.browser?.framePresent === true &&
        interaction.afterClose.browser?.framePartition ===
          "persist:artemis-browser" &&
        interaction.afterClose.browser?.frameSource === "about:blank" &&
        interaction.afterClose.browser?.state === "ready" &&
        interaction.afterClose.browser?.ariaBusy === null,
      interaction.afterClose.browser ?? null,
      "ready public Browser shell with isolated webview child",
    );
    assert(
      "browser-controls-and-address",
      interaction.afterClose.browser?.addressDirection === "ltr" &&
        interaction.afterClose.browser?.addressValue === "" &&
        interaction.afterClose.browser?.backDisabled === true &&
        interaction.afterClose.browser?.forwardDisabled === true &&
        interaction.afterClose.browser?.refreshDisabled === false &&
        interaction.afterClose.browser?.goDisabled === false,
      interaction.afterClose.browser ?? null,
      "LTR address, unavailable history, enabled reload and navigation",
    );
    assert(
      "browser-responsive-geometry",
      interaction.afterClose.browser?.surface?.width >= 320 &&
        interaction.afterClose.browser?.surface?.height > 0 &&
        interaction.afterClose.browser?.toolbar?.width >= 320 &&
        interaction.afterClose.browser?.toolbar?.height > 0 &&
        interaction.afterClose.browser?.viewport?.width >= 320 &&
        interaction.afterClose.browser?.viewport?.height > 0 &&
        interaction.afterClose.browser?.surface?.scrollWidth <=
          interaction.afterClose.browser?.surface?.width + 1 &&
        interaction.afterClose.browser?.toolbar?.scrollWidth <=
          interaction.afterClose.browser?.toolbar?.width + 1,
      interaction.afterClose.browser ?? null,
      "non-zero >=320px Browser shell without horizontal overflow",
    );
    assert(
      "browser-address-submit-loading-error",
      interaction.browserInteraction?.controls?.go === 1 &&
        interaction.browserInteraction?.controls?.submit === 1 &&
        interaction.browserInteraction?.submission?.address ===
          "http://127.0.0.1:1/artemis-mig4-error" &&
        interaction.browserInteraction?.submission?.state === "error" &&
        typeof interaction.browserInteraction?.submission?.errorText ===
          "string" &&
        interaction.browserInteraction.submission.errorText.length > 0 &&
        Number.isFinite(
          interaction.browserInteraction?.submission?.failure?.code,
        ) &&
        typeof interaction.browserInteraction?.submission?.failure
          ?.description === "string" &&
        interaction.browserInteraction.surfaceStates.includes("loading") &&
        interaction.browserInteraction.surfaceStates.includes("error") &&
        interaction.browserInteraction.surfaceStates.includes("ready"),
      interaction.browserInteraction ?? null,
      "one real form submission observed through loading and failed-load UI",
    );
    assert(
      "browser-back-forward-reload-chain",
      interaction.browserInteraction?.controls?.back === 1 &&
        interaction.browserInteraction?.controls?.forward === 1 &&
        interaction.browserInteraction?.controls?.refresh === 1 &&
        interaction.browserInteraction?.beforeBack ===
          interaction.browserInteraction?.secondUrl &&
        interaction.browserInteraction?.afterBack ===
          interaction.browserInteraction?.firstUrl &&
        interaction.browserInteraction?.afterForward ===
          interaction.browserInteraction?.secondUrl &&
        interaction.browserInteraction?.reloadUrl ===
          interaction.browserInteraction?.secondUrl &&
        interaction.browserInteraction?.events?.starts >= 3 &&
        interaction.browserInteraction?.events?.stops >= 3 &&
        interaction.browserInteraction?.events?.failures?.length >= 1 &&
        interaction.browserInteraction?.events?.navigations?.includes(
          interaction.browserInteraction?.firstUrl,
        ) &&
        interaction.browserInteraction?.events?.navigations?.includes(
          interaction.browserInteraction?.secondUrl,
        ),
      interaction.browserInteraction ?? null,
      "real back, forward, and reload buttons over two isolated documents",
    );
    if (testCase.layout === "resizable") {
      assertOpenGeometry("mouse", interaction.mouse);
      assert(
        "mouse-pointer-chain",
        interaction.pointerProbe?.down === 1 &&
          interaction.pointerProbe?.move >= 1 &&
          interaction.pointerProbe?.up === 1,
        interaction.pointerProbe ?? null,
        { down: 1, move: ">= 1", up: 1 },
      );
      assert(
        "mouse-resize-applied",
        interaction.mouse.resizer.value >=
          interaction.afterClose.resizer.value &&
          (interaction.mouse.resizer.value >
            interaction.afterClose.resizer.value ||
            interaction.mouse.resizer.value ===
              interaction.mouse.resizer.maximum),
        {
          before: interaction.afterClose.resizer.value,
          after: interaction.mouse.resizer.value,
          maximum: interaction.mouse.resizer.maximum,
        },
        "increased or clamped at maximum",
      );
      assertOpenGeometry("arrow", interaction.arrow);
      assert(
        "keyboard-arrow-applied",
        interaction.arrow.resizer.value <= interaction.mouse.resizer.value &&
          (interaction.arrow.resizer.value < interaction.mouse.resizer.value ||
            interaction.arrow.resizer.value ===
              interaction.arrow.resizer.minimum),
        {
          before: interaction.mouse.resizer.value,
          after: interaction.arrow.resizer.value,
          minimum: interaction.arrow.resizer.minimum,
        },
        "decreased or clamped at minimum",
      );
      assertOpenGeometry("home", interaction.home);
      const expectedHome = Math.round(
        Math.min(
          interaction.home.resizer.maximum,
          Math.max(
            interaction.home.resizer.minimum,
            interaction.home.workspaceContent.width * 0.62,
          ),
        ),
      );
      assert(
        "keyboard-home-reset",
        interaction.home.resizer.value === expectedHome,
        interaction.home.resizer.value,
        expectedHome,
      );
      assertOpenGeometry("end", interaction.end);
      assert(
        "keyboard-end-maximum",
        interaction.end.resizer.value === interaction.end.resizer.maximum,
        interaction.end.resizer.value,
        interaction.end.resizer.maximum,
      );
    } else {
      assert(
        "compact-resizer-interactions-not-dispatched",
        interaction.mouse === null &&
          interaction.arrow === null &&
          interaction.home === null &&
          interaction.end === null &&
          interaction.pointerProbe === null,
        {
          arrow: interaction.arrow,
          end: interaction.end,
          home: interaction.home,
          mouse: interaction.mouse,
          pointerProbe: interaction.pointerProbe,
        },
        "no pointer or keyboard resize against a hidden compact separator",
      );
    }
    assert(
      "dock-closed-contract",
      interaction.closed.dock.state === "closed" &&
        interaction.closed.dock.ariaHidden === "true" &&
        interaction.closed.dock.inert === true &&
        interaction.closed.dock.visible === false &&
        interaction.closed.resizer.state === "closed" &&
        interaction.closed.resizer.tabIndex === -1,
      {
        dock: interaction.closed.dock,
        resizer: interaction.closed.resizer,
      },
      "hidden inert Dock and unfocusable separator",
    );
    assertOpenGeometry("reopened", interaction.reopened);
    assert(
      "dock-reopen-preserves-tab",
      interaction.reopened.tabs.length === 1 &&
        interaction.reopened.tabs[0].active === true &&
        interaction.reopened.browser?.markersComplete === true &&
        interaction.reopened.browser?.framePresent === true,
      {
        browser: interaction.reopened.browser,
        tabs: interaction.reopened.tabs,
      },
      "one active Browser tab",
    );
    assert(
      "mouse-resize-does-not-select-text",
      interaction.reopened.selectionText === "",
      interaction.reopened.selectionText,
      "",
    );
    if (testCase.scale === 2) {
      assert(
        "two-hundred-percent-layout",
        audit.zoomFactor === 2 &&
          audit.windowInnerWidth === interaction.initial.viewport.innerWidth &&
          interaction.initial.viewport.compactMedia === true &&
          audit.windowInnerWidth >= 320 &&
          audit.windowInnerWidth <= 820,
        {
          auditWidth: audit.windowInnerWidth,
          viewport: interaction.initial.viewport,
          zoomFactor: audit.zoomFactor,
        },
        "320..820 CSS pixels in compact media at zoom factor 2",
      );
    }

    results.push({
      ...testCase,
      accessibility: accessibilityPath,
      assertions,
      screenshot: screenshotPath,
      screenshotBytes,
    });
    console.log(
      `PASS ${testCase.caseId} (${assertions.length} assertions, screenshot ${screenshotBytes} bytes)`,
    );
  }

  const finalStatus = runGit(["status", "--porcelain"]);
  if (finalStatus !== initialStatus) {
    throw new Error(
      `Workspace Dock verification changed tracked worktree state:\n${finalStatus}`,
    );
  }
  const report = {
    format: "artemis-workspace-dock-smoke",
    version: 1,
    candidateHead,
    expectedHead,
    generatedAt: new Date().toISOString(),
    launch: {
      rendererSandbox: true,
      noSandboxFlag: false,
      mode: "single-attempt-built-production-renderer",
    },
    summary: {
      assertions: results.reduce(
        (sum, result) => sum + result.assertions.length,
        0,
      ),
      cases: results.length,
      failed: 0,
      passed: results.length,
    },
    results,
  };
  await writeFile(
    join(outputDirectory, "audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Workspace Dock verification passed (${cases.length} Electron cases; exact HEAD ${candidateHead}).`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
