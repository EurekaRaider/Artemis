import { prepareViewScript } from "./prepare-view.js";
import { collectEvidenceScript } from "./collect-evidence.js";
import { driveSmokeWorkspaceDockEvidence } from "./workspace-dock.js";
import { ipcMain } from "electron";

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app, BrowserWindow } from "electron";

import { IPC } from "../../../../src/shared/api.js";
import {
  browserSessionHost,
  startupTimings,
  isEmbeddedBrowserNavigationAllowed,
} from "../../../../src/main/main.js";

import {
  driveSmokeFormControlsEvidence,
  ensureSmokeWindowFocus,
  driveSmokeNavigationControlsEvidence,
  driveSmokeInputFieldsEvidence,
} from "./focus-evidence.js";
import {
  smokeUserInputTransportEvidence,
  driveSmokeUserInputTransportEvidence,
} from "./user-input-transport.js";
import { emitSmokeCardHeatmapUsageEvents } from "./token-usage.js";
import { smokeMode } from "../../../../test/fixtures/smoke/environment.js";
import { smokeMcpState } from "../../../../test/fixtures/smoke/mcp-state.js";

export function smokeWindowOptions() {
  const smokeScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT;
  const smokeAccessibility = process.env.ARTEMIS_SMOKE_ACCESSIBILITY;
  const smokeArtifacts = Boolean(smokeScreenshot || smokeAccessibility);
  const requestedSmokeWidth = Number(process.env.ARTEMIS_SMOKE_WINDOW_WIDTH);
  const requestedSmokeHeight = Number(process.env.ARTEMIS_SMOKE_WINDOW_HEIGHT);
  const smokeWidth =
    smokeMode && Number.isFinite(requestedSmokeWidth)
      ? Math.max(980, Math.min(2_000, Math.round(requestedSmokeWidth)))
      : 1_420;
  const smokeHeight =
    smokeMode && Number.isFinite(requestedSmokeHeight)
      ? Math.max(680, Math.min(1_400, Math.round(requestedSmokeHeight)))
      : 920;
  return {
    width: smokeWidth,
    height: smokeHeight,
    show: !smokeArtifacts,
    enableLargerThanScreen: smokeArtifacts && process.platform === "darwin",
    backgroundThrottling: !smokeMode,
  };
}
export function installSmokeWindow(window: BrowserWindow) {
  const smokeScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT;
  const smokeAccessibility = process.env.ARTEMIS_SMOKE_ACCESSIBILITY;
  const smokeFocusedScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT_FOCUSED;
  const smokePickedScreenshot = process.env.ARTEMIS_SMOKE_SCREENSHOT_PICKED;
  const smokeArtifacts = Boolean(smokeScreenshot || smokeAccessibility);
  const requestedSmokeWidth = Number(process.env.ARTEMIS_SMOKE_WINDOW_WIDTH);
  const requestedSmokeHeight = Number(process.env.ARTEMIS_SMOKE_WINDOW_HEIGHT);
  const requestedSmokeResizeWidth = Number(
    process.env.ARTEMIS_SMOKE_RESIZE_WIDTH,
  );
  const smokeWidth =
    smokeMode && Number.isFinite(requestedSmokeWidth)
      ? Math.max(980, Math.min(2_000, Math.round(requestedSmokeWidth)))
      : 1_420;
  const smokeHeight =
    smokeMode && Number.isFinite(requestedSmokeHeight)
      ? Math.max(680, Math.min(1_400, Math.round(requestedSmokeHeight)))
      : 920;
  const requestedScale = Number(process.env.ARTEMIS_SMOKE_SCALE ?? "1");
  const smokeScale = [1, 1.25, 1.5, 2].includes(requestedScale)
    ? requestedScale
    : 1;
  // Environment intentionally stays closed below 980 CSS pixels. Open the
  // real Review flow first, then exercise the requested zoom on that panel.
  const smokePreparationScale =
    smokeMode &&
    process.env.ARTEMIS_SMOKE_VIEW === "nocturne-review-comment-zoom"
      ? 1
      : smokeScale;
  let smokePreloadSecurity: {
    contextIsolated: boolean;
    sandboxed: boolean;
  } | null = null;
  let smokeBrowserWebviewSecurity: {
    allowRunningInsecureContent: boolean;
    attached: boolean;
    contextIsolation: boolean;
    guestType: string | null;
    navigationAllowed: boolean;
    nodeIntegration: boolean;
    nodeIntegrationInSubFrames: boolean;
    partition: string | null;
    preloadPresent: boolean;
    sandbox: boolean;
    webSecurity: boolean;
  } | null = null;

  window.webContents.on(
    "will-attach-webview",
    (_event, webPreferences, params) => {
      const navigationAllowed = isEmbeddedBrowserNavigationAllowed(
        params.src ?? "",
      );
      if (smokeMode) {
        smokeBrowserWebviewSecurity = {
          allowRunningInsecureContent: false,
          attached: false,
          contextIsolation: true,
          guestType: null,
          navigationAllowed,
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          partition:
            typeof webPreferences.partition === "string"
              ? webPreferences.partition
              : null,
          preloadPresent: typeof webPreferences.preload === "string",
          sandbox: true,
          webSecurity: true,
        };
      }
    },
  );
  window.webContents.on("did-attach-webview", (_event, guest) => {
    if (smokeBrowserWebviewSecurity) {
      smokeBrowserWebviewSecurity = {
        ...smokeBrowserWebviewSecurity,
        attached: true,
        guestType: guest.getType(),
      };
    }
  });
  ipcMain.once(IPC.rendererReady, (event, runtimeSecurity: unknown) => {
    if (event.sender.id === window.webContents.id) {
      if (
        smokeMode &&
        typeof runtimeSecurity === "object" &&
        runtimeSecurity !== null &&
        typeof (runtimeSecurity as { contextIsolated?: unknown })
          .contextIsolated === "boolean" &&
        typeof (runtimeSecurity as { sandboxed?: unknown }).sandboxed ===
          "boolean"
      ) {
        smokePreloadSecurity = {
          contextIsolated: (runtimeSecurity as { contextIsolated: boolean })
            .contextIsolated,
          sandboxed: (runtimeSecurity as { sandboxed: boolean }).sandboxed,
        };
      }
    }
  });
  if (process.platform === "win32" && smokeArtifacts) {
    // Set the final content viewport before React initializes its sidebar state.
    window.setContentSize(smokeWidth, smokeHeight);
  }
  const smokeRendererConsoleEntries: Array<{
    level: "warning" | "error";
    message: string;
    lineNumber: number;
  }> = [];
  if (smokeMode) {
    window.webContents.on("console-message", (details) => {
      if (details.level === "warning" || details.level === "error") {
        smokeRendererConsoleEntries.push({
          level: details.level,
          message: details.message,
          lineNumber: details.lineNumber,
        });
      }
    });
  }
  if (smokeMode) {
    window.webContents.setZoomFactor(smokePreparationScale);
  }
  if (smokeArtifacts) {
    window.once("ready-to-show", () => {
      if (smokeScreenshot) {
        const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
        const focusEvidenceView =
          view.startsWith("form-controls-") ||
          view === "mcp-editor-form-controls" ||
          view === "turn-changes-form-controls" ||
          view === "navigation-token-usage" ||
          view === "markdown-editor-navigation-toolbar" ||
          view === "markdown-editor-navigation-preview" ||
          (process.env.ARTEMIS_SMOKE_GOAL_FOCUS_PROBE === "1" &&
            view.startsWith("goal-"));
        if (focusEvidenceView || process.env.ARTEMIS_SMOKE_VISIBLE === "1") {
          // Keep focus-evidence views on the active display. A macOS runner
          // cannot activate a window parked outside every screen, so moving
          // these form and navigation views offscreen makes real
          // :focus-visible evidence
          // impossible even when the renderer interaction is correct.
          window.center();
          window.show();
          if (process.platform === "darwin") app.focus({ steal: true });
          window.focus();
        } else {
          window.setPosition(-10_000, -10_000);
          window.showInactive();
        }
      } else {
        window.show();
      }
    });
  }
  if (smokeScreenshot || smokeAccessibility) {
    // Concurrent Goal smoke launches can take over 15 seconds on macOS x64.
    // Startup performance is checked separately by the screenshot matrix.
    const readyTimeout = setTimeout(() => {
      console.error("Smoke validation failed: renderer did not paint in time.");
      app.exit(1);
    }, 30_000);
    ipcMain.once(IPC.rendererReady, (event) => {
      clearTimeout(readyTimeout);
      if (event.sender.id !== window.webContents.id) {
        app.exit(1);
        return;
      }
      window.webContents.setZoomFactor(smokePreparationScale);
      // Windows virtual displays can clamp the size at construction time, and
      // the native frame otherwise reduces the requested content viewport.
      if (process.platform === "win32" && smokeArtifacts) {
        window.setContentSize(smokeWidth, smokeHeight);
      }
      if (smokeMode && Number.isFinite(requestedSmokeResizeWidth)) {
        window.setSize(
          Math.max(980, Math.min(2_000, Math.round(requestedSmokeResizeWidth))),
          920,
        );
      }
      // PR10C review (severe 1): a multi-question-ui* view activates the
      // smoke channel only alongside its dedicated ARTEMIS_SMOKE_MULTI_UI
      // sentinel; without it the view is unknown here and prepares
      // nothing — the same contract as the ARTEMIS_SMOKE_USER_INPUT gate
      // below and the seedSmokeMultiQuestionUiFixture guard.
      const rawSmokeView = process.env.ARTEMIS_SMOKE_VIEW;
      const requestedSmokeView = rawSmokeView?.startsWith("multi-question-ui")
        ? process.env.ARTEMIS_SMOKE_MULTI_UI === "1"
          ? rawSmokeView
          : undefined
        : rawSmokeView;
      // The smoke window is shown offscreen via showInactive(), so the
      // renderer document never has OS focus and element.focus() would only
      // move activeElement without firing focus events. Focusing the web
      // contents first lets the card-heatmap cell focus run the real
      // onFocus -> hovered -> tooltip chain for the §6 focus evidence.
      if (
        smokeMode &&
        [
          "card-heatmap",
          "secondary-pages-token-usage",
          "environment-context-usage",
        ].includes(requestedSmokeView ?? "")
      ) {
        window.webContents.focus();
      }
      const smokeWorkspaceMenuKind =
        requestedSmokeView === "nocturne-terminal"
          ? "terminal"
          : requestedSmokeView?.startsWith("markdown-editor-") &&
              requestedSmokeView !== "markdown-editor-navigation-preview"
            ? "file"
            : undefined;
      const selectSmokeWorkspaceMenu = async () => {
        if (!smokeMode || !smokeWorkspaceMenuKind) return;
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const menu = window
            .getChildWindows()
            .find((child) => !child.isDestroyed() && child.isVisible());
          if (menu && !menu.webContents.isLoadingMainFrame()) {
            const point = await menu.webContents.executeJavaScript(`(() => {
              const entry = document.querySelector(${JSON.stringify(`button[data-kind="${smokeWorkspaceMenuKind}"]`)});
              if (!entry) return null;
              const rect = entry.getBoundingClientRect();
              return { x: Math.round(rect.x + rect.width / 2),
                y: Math.round(rect.y + rect.height / 2) };
            })()`);
            if (point) {
              // Selection destroys the menu. Send native input after the
              // evaluation returns so its promise cannot die with the page.
              menu.webContents.sendInputEvent({
                type: "mouseDown",
                ...point,
                button: "left",
                clickCount: 1,
              });
              menu.webContents.sendInputEvent({
                type: "mouseUp",
                ...point,
                button: "left",
                clickCount: 1,
              });
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(
          `Native ${smokeWorkspaceMenuKind} tab entry did not render.`,
        );
      };
      const nativeWorkspaceSelection = selectSmokeWorkspaceMenu();
      const prepareSmokeView = process.env.ARTEMIS_SMOKE_USER_INPUT
        ? window.webContents.executeJavaScript(
            "document.querySelector('.thread-select')?.click()",
          )
        : requestedSmokeView
          ? window.webContents.executeJavaScript(
              prepareViewScript(requestedSmokeView, smokeWidth, smokeScale),
            )
          : Promise.resolve();
      const requestedSettleDelay = Number(
        process.env.ARTEMIS_SMOKE_SETTLE_DELAY,
      );
      const settleDelay = Number.isFinite(requestedSettleDelay)
        ? Math.max(0, Math.min(5_000, requestedSettleDelay))
        : process.env.ARTEMIS_SMOKE_USER_INPUT || requestedSmokeView
          ? 1_500
          : 500;
      void Promise.all([prepareSmokeView, nativeWorkspaceSelection])
        .then(async () => {
          if (smokePreparationScale !== smokeScale) {
            window.webContents.setZoomFactor(smokeScale);
          }
          if (
            !Number.isFinite(requestedSettleDelay) &&
            requestedSmokeView?.startsWith("environment")
          ) {
            // Environment drivers already wait for their actual UI state.
            // Capture completed transitions and painted frames instead of
            // adding the same 1.5-second sleep to every isolated case.
            await window.webContents.executeJavaScript(`(async () => {
              await document.fonts.ready;
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const animations = document.getAnimations().filter((animation) =>
                animation.playState === 'running' &&
                Number.isFinite(animation.effect?.getComputedTiming().endTime),
              );
              await Promise.allSettled(animations.map((animation) => animation.finished));
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
            })()`);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, settleDelay));
          if (smokePreparationScale !== smokeScale) {
            const commentVisible = await window.webContents
              .executeJavaScript(`(() => {
              const input = document.querySelector('.review-comment-editor textarea');
              if (!(input instanceof HTMLTextAreaElement) || !input.checkVisibility({ visibilityProperty: true })) return false;
              const bounds = input.getBoundingClientRect();
              return bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
            })()`);
            if (
              window.webContents.getZoomFactor() !== smokeScale ||
              !commentVisible
            ) {
              throw new Error(
                "Review comment was not visible at the requested zoom.",
              );
            }
          }
        })
        .then(async () => {
          // PR9B card-heatmap smoke: view routing has settled, so the Token
          // Usage page is mounted with its live subscription active and the
          // synthetic usage sequence can ride the real agent-event channel.
          emitSmokeCardHeatmapUsageEvents(window);
          if (
            smokeMode &&
            ["card-heatmap", "secondary-pages-token-usage"].includes(
              process.env.ARTEMIS_SMOKE_VIEW ?? "",
            )
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
          if (smokeMode && requestedSmokeView?.startsWith("nocturne-update-")) {
            const stateName = requestedSmokeView.slice(
              "nocturne-update-".length,
            );
            window.webContents.send(IPC.updateStatus, {
              state:
                stateName === "waiting" || stateName === "complete"
                  ? "downloaded"
                  : stateName,
              currentVersion: app.getVersion(),
              availableVersion: "1.7.21",
              rollbackAvailable: stateName === "error",
              ...(stateName === "downloading"
                ? {
                    progress: 42,
                    downloadedBytes: 18.4 * 1048576,
                    totalBytes: 43.6 * 1048576,
                  }
                : {}),
              ...(stateName === "error"
                ? { message: "Synthetic update verification failed" }
                : {}),
              ...(stateName === "complete"
                ? { completedVersion: app.getVersion() }
                : {}),
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (
            smokeMode &&
            requestedSmokeView?.startsWith("nocturne-computer-")
          ) {
            window.webContents.send(IPC.computerState, {
              version: 1,
              state: requestedSmokeView.endsWith("paused")
                ? "paused"
                : "acting",
              threadId: "artemis-smoke-environment-thread",
              target: {
                id: "artemis-smoke-browser",
                kind: "browser",
                name: "Synthetic Browser",
              },
              foreground: true,
              ...(requestedSmokeView.endsWith("paused")
                ? { reason: "User took control" }
                : {}),
            });
            await new Promise((resolve) => setTimeout(resolve, 1_100));
          }
          let keyboardFocusEvidence = false;
          if (smokeMode) {
            const formFocusEvidence = await driveSmokeFormControlsEvidence(
              window,
              requestedSmokeView,
            );
            const navigationFocusEvidence =
              await driveSmokeNavigationControlsEvidence(
                window,
                requestedSmokeView,
              );
            keyboardFocusEvidence =
              formFocusEvidence || navigationFocusEvidence;
            await driveSmokeWorkspaceDockEvidence(
              window,
              requestedSmokeView,
              browserSessionHost,
            );
          }
          // PR10B review round 3 (nit 6): the user-input-transport PNG is
          // captured inside its evidence driver after the broker
          // injections, so the screenshot shows the rendered input cards
          // instead of an empty thread.
          if (
            smokeScreenshot &&
            requestedSmokeView !== "user-input-transport"
          ) {
            // Native focus can be lost after keyboard activation while another
            // desktop app is active. Reacquire it before recording evidence;
            // keep the actual Tab/Space result and the focus assertions intact.
            if (keyboardFocusEvidence) await ensureSmokeWindowFocus(window);
            const image = await window.webContents.capturePage();
            await writeFile(smokeScreenshot, image.toPNG());
          }
          // PR9C input-fields smoke: after the default-state screenshot the
          // keyboard-evidence driver runs (real Tab traversal, focus probes,
          // busy-driven disable, Enter -> intercepted file chooser) before
          // the accessibility audit snapshot reads window.__inputFieldsProbe.
          if (smokeMode && requestedSmokeView?.startsWith("input-fields-")) {
            await driveSmokeInputFieldsEvidence(window, {
              defaultScreenshot: smokeScreenshot,
              focusedScreenshot: smokeFocusedScreenshot,
              pickedScreenshot: smokePickedScreenshot,
            });
          }
          // PR10B user-input-transport smoke: with the producer dormant the
          // only legal driver is the direct broker-request path, so the
          // evidence driver injects synthetic legacy and multi-question
          // requests through the real main-process handlers and asserts the
          // transport contract end to end before the audit snapshot.
          if (smokeMode && requestedSmokeView === "user-input-transport") {
            await driveSmokeUserInputTransportEvidence(window, {
              screenshot: smokeScreenshot,
            });
          }
          let goalReducedMotionActiveTransform: string | null = null;
          if (
            smokeMode &&
            process.env.ARTEMIS_SMOKE_GOAL_REDUCED_MOTION === "1"
          ) {
            window.webContents.focus();
            const actionPoint = (await window.webContents.executeJavaScript(`
              (() => {
                const action = document.querySelector(
                  '.goal-bar-actions [data-artemis-component="icon-button"]',
                );
                const bounds = action?.getBoundingClientRect();
                return bounds
                  ? {
                      x: Math.round(bounds.left + bounds.width / 2),
                      y: Math.round(bounds.top + bounds.height / 2),
                    }
                  : null;
              })()
            `)) as { x: number; y: number } | null;
            if (!actionPoint) {
              throw new Error("Reduced-motion Goal action probe is missing.");
            }
            window.webContents.sendInputEvent({
              type: "mouseMove",
              ...actionPoint,
            });
            window.webContents.sendInputEvent({
              type: "mouseDown",
              button: "left",
              clickCount: 1,
              ...actionPoint,
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            goalReducedMotionActiveTransform = (await window.webContents
              .executeJavaScript(`
              getComputedStyle(document.querySelector(
                '.goal-bar-actions [data-artemis-component="icon-button"]',
              )).transform
            `)) as string;
            window.webContents.sendInputEvent({
              type: "mouseMove",
              x: 0,
              y: 0,
            });
            window.webContents.sendInputEvent({
              type: "mouseUp",
              button: "left",
              clickCount: 1,
              x: 0,
              y: 0,
            });
            // Re-hit-test after releasing mouse capture before auditing the
            // resting styles; Windows may retain hover during the drag.
            window.webContents.sendInputEvent({
              type: "mouseMove",
              x: 0,
              y: 0,
            });
            const resetDeadline = Date.now() + 2_000;
            while (
              await window.webContents.executeJavaScript(`
                !!document.querySelector(
                  '.goal-bar-actions button:is(:hover, :active)',
                )
              `)
            ) {
              if (Date.now() >= resetDeadline) {
                throw new Error("Reduced-motion Goal action did not reset.");
              }
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
          }
          if (
            smokeMode &&
            requestedSmokeView?.startsWith("goal-") &&
            process.env.ARTEMIS_SMOKE_GOAL_FOCUS_PROBE === "1"
          ) {
            window.webContents.focus();
            window.webContents.sendInputEvent({
              type: "keyDown",
              keyCode: "Tab",
            });
            window.webContents.sendInputEvent({
              type: "keyUp",
              keyCode: "Tab",
            });
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (smokeAccessibility) {
            if (keyboardFocusEvidence) await ensureSmokeWindowFocus(window);
            const result = (await window.webContents.executeJavaScript(
              collectEvidenceScript(
                requestedSmokeView,
                goalReducedMotionActiveTransform,
              ),
            )) as Record<string, unknown>;
            const runtimeGlobalSecurity = result.runtimeGlobalSecurity as
              { processType?: unknown; requireType?: unknown } | undefined;
            await writeFile(
              smokeAccessibility,
              `${JSON.stringify(
                {
                  ...result,
                  requestedTheme:
                    process.env.ARTEMIS_SMOKE_THEME === "light" ||
                    process.env.ARTEMIS_SMOKE_THEME === "dark"
                      ? process.env.ARTEMIS_SMOKE_THEME
                      : "system",
                  rendererConsoleEntries: smokeRendererConsoleEntries,
                  runtimeSecurity: {
                    contextIsolation:
                      smokePreloadSecurity?.contextIsolated ?? null,
                    nodeIntegration: !(
                      runtimeGlobalSecurity?.processType === "undefined" &&
                      runtimeGlobalSecurity?.requireType === "undefined"
                    ),
                    sandbox: smokePreloadSecurity?.sandboxed ?? null,
                  },
                  browserWebviewSecurity: smokeBrowserWebviewSecurity,
                  windowFocused: window.isFocused(),
                  userInputTransport: smokeUserInputTransportEvidence ?? null,
                  zoomFactor: smokeScale,
                  startupTimings,
                  reconnectIpcCalls: smokeMcpState.reconnectIpcCalls,
                },
                undefined,
                2,
              )}\n`,
              "utf8",
            );
          }
        })
        .then(() => app.quit())
        .catch((error) => {
          console.error("Smoke validation failed.", error);
          app.exit(1);
        });
    });
  }
}
