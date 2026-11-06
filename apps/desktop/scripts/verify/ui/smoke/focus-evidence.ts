import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";

import { smokeMode } from "../../../../test/fixtures/smoke/environment.js";

export type SmokeInputFieldsActivationEvidence = {
  interceptionArmed: boolean;
  armError?: string;
  entered: boolean;
  fileChooserOpened: boolean;
  acceptedFiles: string[];
  acceptError?: string;
};

export type SmokeFocusFrameEvidence = {
  targetStillFocused: boolean;
  activeElementAtCapture: string;
  doubleRafCompleted: boolean;
  framePresented: boolean;
  frameSignal: "beginFrameSubscription" | "unavailable";
};

export type SmokeInputFieldsRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SmokeInputFieldsFocusProbe = {
  outlineColor?: string | null;
  labelOutlineColor?: string | null;
  labelMatchesSiblingFocus?: boolean;
  targetRect?: SmokeInputFieldsRect | null;
  labelRect?: SmokeInputFieldsRect | null;
  viewport?: { innerWidth?: number | null } | null;
} | null;

export type SmokeFocusPixelsEvidence = {
  analysisRuntime?: "electron-nativeImage";
  error?: string;
  changedPixelCount?: number;
  ringPixelCount?: number;
  scale?: number;
  sampledBand?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  ringColor?: [number, number, number];
  sizes?: { width: number; height: number }[];
};

export const analyzeSmokeFocusPixels = ({
  defaultPath,
  focusedPath,
  ringColorSource,
  ringRect,
  viewportWidth,
}: {
  defaultPath: string | undefined;
  focusedPath: string | undefined;
  ringColorSource: string | null | undefined;
  ringRect: SmokeInputFieldsRect | null;
  viewportWidth: number | null | undefined;
}): SmokeFocusPixelsEvidence => {
  if (!defaultPath || !focusedPath) {
    return { error: "missing capture artifact path" };
  }
  if (
    !ringRect ||
    ![ringRect.x, ringRect.y, ringRect.width, ringRect.height].every((value) =>
      Number.isFinite(value),
    )
  ) {
    return { error: "missing finite focus-time rect" };
  }
  if (typeof viewportWidth !== "number" || viewportWidth <= 0) {
    return { error: "missing positive viewport width" };
  }
  const ringColorMatch = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/u.exec(
    ringColorSource ?? "",
  );
  if (!ringColorMatch) {
    return { error: "unparsable focus-time ring color: " + ringColorSource };
  }
  const targetRed = Number(ringColorMatch[1]);
  const targetGreen = Number(ringColorMatch[2]);
  const targetBlue = Number(ringColorMatch[3]);
  const defaultImage = nativeImage.createFromPath(defaultPath);
  const focusedImage = nativeImage.createFromPath(focusedPath);
  if (defaultImage.isEmpty() || focusedImage.isEmpty()) {
    return { error: "unreadable capture artifact" };
  }
  const defaultSize = defaultImage.getSize();
  const focusedSize = focusedImage.getSize();
  if (
    defaultSize.width !== focusedSize.width ||
    defaultSize.height !== focusedSize.height
  ) {
    return { error: "size-mismatch", sizes: [defaultSize, focusedSize] };
  }
  const width = focusedSize.width;
  const height = focusedSize.height;
  const scale = width / viewportWidth;
  // toBitmap() hands back raw 4-byte BGRA pixels (alpha last; a pure red
  // probe pixel decodes to 00 00 ff ff) - the same lossless RGBA pixel
  // grid the previous PIL decode produced from the identical PNG, so the
  // byte-wise comparison preserves the old numeric criteria exactly.
  const defaultBitmap = defaultImage.toBitmap();
  const focusedBitmap = focusedImage.toBitmap();
  const expectedBytes = width * height * 4;
  if (
    defaultBitmap.length !== expectedBytes ||
    focusedBitmap.length !== expectedBytes
  ) {
    return {
      error: "unexpected bitmap stride",
      sizes: [defaultSize, focusedSize],
    };
  }
  let changedPixelCount = 0;
  for (let offset = 0; offset < expectedBytes; offset += 4) {
    if (
      Math.abs(
        defaultBitmap.readUInt8(offset) - focusedBitmap.readUInt8(offset),
      ) > 8 ||
      Math.abs(
        defaultBitmap.readUInt8(offset + 1) -
          focusedBitmap.readUInt8(offset + 1),
      ) > 8 ||
      Math.abs(
        defaultBitmap.readUInt8(offset + 2) -
          focusedBitmap.readUInt8(offset + 2),
      ) > 8
    ) {
      changedPixelCount += 1;
    }
  }
  // Python's round() rounds halves to even; replicating it keeps the
  // sampled band byte-identical to the previous PIL implementation so the
  // counts stay directly comparable across the migration.
  const roundHalfToEven = (value: number): number => {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction > 0.5) {
      return floor + 1;
    }
    if (fraction < 0.5) {
      return floor;
    }
    return floor % 2 === 0 ? floor : floor + 1;
  };
  const inner = 1.0;
  const outer = 5.0;
  const left = Math.max(0, roundHalfToEven((ringRect.x - outer) * scale));
  const top = Math.max(0, roundHalfToEven((ringRect.y - outer) * scale));
  const right = Math.min(
    width,
    roundHalfToEven((ringRect.x + ringRect.width + outer) * scale),
  );
  const bottom = Math.min(
    height,
    roundHalfToEven((ringRect.y + ringRect.height + outer) * scale),
  );
  const sampledBand = { left, top, right, bottom };
  if (right <= left || bottom <= top) {
    return {
      error: "band-outside-capture",
      scale,
      sampledBand,
      ringColor: [targetRed, targetGreen, targetBlue],
    };
  }
  const innerLeft = roundHalfToEven((ringRect.x - inner) * scale) - left;
  const innerTop = roundHalfToEven((ringRect.y - inner) * scale) - top;
  const innerRight =
    roundHalfToEven((ringRect.x + ringRect.width + inner) * scale) - left;
  const innerBottom =
    roundHalfToEven((ringRect.y + ringRect.height + inner) * scale) - top;
  let ringPixelCount = 0;
  for (let y = top; y < bottom; y += 1) {
    const bandY = y - top;
    for (let x = left; x < right; x += 1) {
      const bandX = x - left;
      if (
        bandX >= innerLeft &&
        bandX < innerRight &&
        bandY >= innerTop &&
        bandY < innerBottom
      ) {
        continue;
      }
      const offset = (y * width + x) * 4;
      if (focusedBitmap.readUInt8(offset + 3) <= 0) {
        continue;
      }
      if (
        Math.abs(focusedBitmap.readUInt8(offset) - targetBlue) <= 60 &&
        Math.abs(focusedBitmap.readUInt8(offset + 1) - targetGreen) <= 60 &&
        Math.abs(focusedBitmap.readUInt8(offset + 2) - targetRed) <= 60
      ) {
        ringPixelCount += 1;
      }
    }
  }
  return {
    analysisRuntime: "electron-nativeImage",
    changedPixelCount,
    ringPixelCount,
    scale,
    sampledBand,
    ringColor: [targetRed, targetGreen, targetBlue],
    sizes: [defaultSize, focusedSize],
  };
};

export async function driveSmokeFormControlsEvidence(
  window: BrowserWindow,
  view: string | undefined,
): Promise<boolean> {
  const targets = {
    "form-controls-archive": {
      selector:
        '[data-artemis-component="search-field"].archive-search [data-part="control"]',
    },
    "form-controls-settings": {
      selector:
        '.provider-add-model [data-artemis-component="text-field"] input[type="number"]',
    },
    "form-controls-settings-custom": {
      selector:
        '.provider-form [data-artemis-component="checkbox"] [data-part="control"]',
    },
    "form-controls-composer": {
      selector: '.composer-run-modes [role="radio"][aria-checked="true"]',
      rootSelector:
        '.composer-run-modes[data-artemis-component="run-mode-control"]',
    },
    "mcp-editor-form-controls": {
      selector:
        '.mcp-editor [data-artemis-component="select"] [data-part="trigger"]',
      rootSelector: '.mcp-editor [data-artemis-component="select"]',
    },
    "turn-changes-form-controls": {
      selector:
        '.review-scope-select [data-artemis-component="segmented-control"] [aria-pressed="true"]',
      rootSelector:
        '.review-scope-select [data-artemis-component="segmented-control"]',
    },
  } as const;
  const target = view ? targets[view as keyof typeof targets] : undefined;
  if (!target) return false;

  const contents = window.webContents;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const pressKey = async (key: string, virtualKeyCode: number) => {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
    }
    const parameters = {
      key,
      code: key === " " ? "Space" : key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  };

  await ensureSmokeWindowFocus(window);
  let targetFocused = false;
  for (let presses = 0; presses < 200; presses += 1) {
    targetFocused = await evaluate<boolean>(
      `document.activeElement === document.querySelector(${JSON.stringify(target.selector)})`,
    );
    if (targetFocused) break;
    await pressKey("Tab", 9);
    await wait(15);
  }
  targetFocused = await evaluate<boolean>(
    `document.activeElement === document.querySelector(${JSON.stringify(target.selector)})`,
  );
  const documentHasFocus = await evaluate<boolean>("document.hasFocus()");
  if (documentHasFocus && !targetFocused) {
    throw new Error(
      `Form-control Tab traversal did not reach ${target.selector}.`,
    );
  }

  if (view === "form-controls-composer") {
    const before = await evaluate<string>(
      `document.querySelector('.composer-run-modes [aria-checked="true"]')?.textContent?.trim()`,
    );
    await evaluate(
      `window.__modeControlRoot = document.querySelector('.composer-run-modes')`,
    );
    await pressKey("ArrowRight", 39);
    await wait(350);
    const after = await evaluate<string>(
      `document.querySelector('.composer-run-modes [aria-checked="true"]')?.textContent?.trim()`,
    );
    await pressKey("ArrowLeft", 37);
    await wait(350);
    await evaluate(`window.__formControlsInteraction = {
      before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)},
      restored: document.querySelector('.composer-run-modes [aria-checked="true"]')?.textContent?.trim(),
      rootStable: window.__modeControlRoot === document.querySelector('.composer-run-modes'),
      modes: [...document.querySelectorAll('.composer-run-modes [role="radio"]')].map(button => ({
        label: button.textContent.trim(), checked: button.getAttribute('aria-checked'),
        tabIndex: button.tabIndex, width: button.getBoundingClientRect().width,
      })),
    }`);
    return true;
  }

  if (view === "turn-changes-form-controls") {
    await evaluate(
      `window.__reviewScopeRoot = document.querySelector('.review-scope-select [data-artemis-component="segmented-control"]'); window.__reviewScopeBefore = window.__reviewScopeRoot.querySelector('[aria-pressed="true"]').textContent.trim();`,
    );
    await pressKey("Tab", 9);
    await pressKey(" ", 32);
    await wait(350);
    const interaction = await evaluate<{
      keyboardActivated: boolean;
      rootStable: boolean;
    }>(`(() => {
      const root = document.querySelector('.review-scope-select [data-artemis-component="segmented-control"]');
      window.__formControlsInteraction = { keyboardActivated: root?.querySelector('[aria-pressed="true"]')?.textContent.trim() !== window.__reviewScopeBefore, rootStable: root === window.__reviewScopeRoot, before: window.__reviewScopeBefore, after: root?.querySelector('[aria-pressed="true"]')?.textContent.trim(), active: document.activeElement?.outerHTML };
      return window.__formControlsInteraction;
    })()`);
    if (!interaction.keyboardActivated || !interaction.rootStable)
      throw new Error(
        `Review scope did not activate from the keyboard: ${JSON.stringify(interaction)}.`,
      );
    // Restore the historical review after proving keyboard scope selection,
    // so the subsequent geometry capture still includes the populated diff.
    await evaluate(
      `document.querySelector('.turn-change-actions button:last-child')?.click()`,
    );
    await wait(500);
    for (let presses = 0; presses < 200; presses += 1) {
      if (
        await evaluate<boolean>(
          `document.activeElement === document.querySelector(${JSON.stringify(target.selector)})`,
        )
      )
        break;
      await pressKey("Tab", 9);
      await wait(15);
    }
    return true;
  }

  if ("rootSelector" in target) {
    if (!targetFocused) {
      throw new Error(
        `Form-control keyboard evidence cannot target ${target.selector}.`,
      );
    }
    await pressKey("ArrowDown", 40);
    const interaction = await evaluate<{
      keyboardOpened: boolean;
      menuOpen: boolean;
      rootStable: boolean;
    }>(`(async () => {
      const wait = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const trigger = document.querySelector(${JSON.stringify(target.selector)});
      const root = trigger?.closest('[data-artemis-component="select"]');
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline && !root?.querySelector('[data-part="listbox"]')) {
        await wait(50);
      }
      return {
        keyboardOpened: Boolean(root?.querySelector('[data-part="listbox"]')),
        menuOpen: Boolean(root?.querySelector('[data-part="menu"]')),
        rootStable: root === document.querySelector(${JSON.stringify(target.rootSelector)}),
      };
    })()`);
    if (!interaction.keyboardOpened) {
      throw new Error(`Public Select did not keyboard-open for ${view}.`);
    }
    await evaluate(`window.__formControlsInteraction = ${JSON.stringify({ view })};
      Object.assign(window.__formControlsInteraction, ${JSON.stringify(interaction)});`);
  }

  await evaluate(`new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  )`);
  return true;
}

export async function ensureSmokeWindowFocus(
  window: BrowserWindow,
): Promise<void> {
  const contents = window.webContents;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (
      window.isFocused() &&
      (await contents.executeJavaScript("document.hasFocus()"))
    ) {
      await contents.executeJavaScript(`new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      return;
    }
    if (process.platform === "darwin") app.focus({ steal: true });
    window.focus();
    contents.focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Navigation smoke window could not acquire native focus.");
}

export async function driveSmokeNavigationControlsEvidence(
  window: BrowserWindow,
  view: string | undefined,
): Promise<boolean> {
  const targets = {
    "navigation-token-usage": {
      activation: "Space",
      expectedLabel: "Weekly",
      rootSelector:
        '.token-usage-tabs[data-artemis-component="segmented-control"]',
      targetSelector:
        '.token-usage-tabs[data-artemis-component="segmented-control"] [data-part="segment"][aria-pressed="false"]',
    },
    "markdown-editor-navigation-toolbar": {
      activation: "Space",
      expectedLabel: "Source",
      rootSelector:
        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"]',
      targetSelector:
        '[data-artemis-component="workspace-file-layout"] [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] [data-part="segment"][aria-pressed="false"]',
    },
    "markdown-editor-navigation-preview": {
      activation: "Space",
      expectedLabel: "Source",
      rootSelector:
        '[data-artemis-component="workspace-tab-pane"][data-state="active"] > [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"]',
      targetSelector:
        '[data-artemis-component="workspace-tab-pane"][data-state="active"] > [data-artemis-component="workspace-editor-toolbar"] [data-part="mode"] [data-artemis-component="segmented-control"] [data-part="segment"][aria-pressed="false"]',
    },
  } as const;
  const target = view ? targets[view as keyof typeof targets] : undefined;
  if (!target) return false;

  const contents = window.webContents;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const pressKey = async (
    key: string,
    code: string,
    virtualKeyCode: number,
  ): Promise<void> => {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    const parameters = {
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    };
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  };

  // macOS activation is asynchronous; CDP can otherwise deliver to a DOM
  // target while its native window is inactive, invalidating keyboard evidence.
  await ensureSmokeWindowFocus(window);
  let focused = false;
  for (let presses = 0; presses < 300; presses += 1) {
    focused = await evaluate<boolean>(
      `document.activeElement === document.querySelector(${JSON.stringify(target.targetSelector)})`,
    );
    if (focused) break;
    await pressKey("Tab", "Tab", 9);
    await wait(15);
  }
  if (!focused) {
    throw new Error(
      `Navigation-control Tab traversal did not reach ${target.targetSelector}.`,
    );
  }

  await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(target.rootSelector)});
    const target = document.querySelector(${JSON.stringify(target.targetSelector)});
    if (!(root instanceof HTMLElement) || !(target instanceof HTMLButtonElement)) {
      throw new Error('Navigation smoke target disappeared before activation.');
    }
    window.__navigationControlsRoot = root;
    window.__navigationControlsClickCount = 0;
    target.addEventListener('click', () => {
      window.__navigationControlsClickCount += 1;
    });
    window.__navigationControlsBefore = {
      activeText: document.activeElement?.textContent?.trim() ?? null,
      selected: [...root.querySelectorAll('button')].map((button) => ({
        label: button.textContent?.trim() ?? '',
        pressed: button.getAttribute('aria-pressed'),
        selected: button.getAttribute('aria-selected'),
        tabIndex: button.tabIndex,
      })),
    };
  })()`);

  await pressKey(" ", "Space", 32);
  await wait(300);
  const interaction = await evaluate<Record<string, unknown>>(`(() => {
    const root = document.querySelector(${JSON.stringify(target.rootSelector)});
    const buttons = root instanceof HTMLButtonElement
      ? [root]
      : [...(root?.querySelectorAll('button') ?? [])];
    const active = document.activeElement;
    const selected = root instanceof HTMLButtonElement ? root : buttons.find(
      (button) =>
        button.getAttribute('aria-selected') === 'true' ||
        button.getAttribute('aria-pressed') === 'true',
    );
    const panelId = selected?.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    window.__navigationControlsInteraction = {
      view: ${JSON.stringify(view)},
      activation: ${JSON.stringify(target.activation)},
      activeText: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? null,
      before: window.__navigationControlsBefore,
      clickCount: window.__navigationControlsClickCount,
      expectedLabel: ${JSON.stringify(target.expectedLabel)},
      panelId,
      panelLabelledBy: panel?.getAttribute('aria-labelledby') ?? null,
      rootStable: root === window.__navigationControlsRoot,
      selectedText: selected?.getAttribute('aria-label') ?? selected?.textContent?.trim() ?? null,
      sourceSurfacePresent:
        document.querySelector(
          '[data-artemis-component="workspace-source-editor"] [data-part="source"]',
        ) !== null,
    };
    return window.__navigationControlsInteraction;
  })()`);
  if (
    interaction.rootStable !== true ||
    interaction.selectedText !== target.expectedLabel ||
    interaction.activeText !== target.expectedLabel
  ) {
    throw new Error(
      `Navigation control did not activate the expected selection for ${view}: ${JSON.stringify(interaction)}.`,
    );
  }
  if (target.activation === "Space" && interaction.clickCount !== 1) {
    throw new Error(
      `Navigation control Space activation did not emit exactly one click for ${view}: ${JSON.stringify(interaction)}.`,
    );
  }
  return true;
}

export async function driveSmokeInputFieldsEvidence(
  window: BrowserWindow,
  artifacts: {
    defaultScreenshot?: string | undefined;
    focusedScreenshot?: string | undefined;
    pickedScreenshot?: string | undefined;
  },
): Promise<void> {
  const view = process.env.ARTEMIS_SMOKE_VIEW;
  if (!smokeMode || !view?.startsWith("input-fields-")) {
    return;
  }
  const contents = window.webContents;
  const evaluate = async <T>(script: string): Promise<T> =>
    (await contents.executeJavaScript(script)) as T;
  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const activation: SmokeInputFieldsActivationEvidence = {
    interceptionArmed: false,
    entered: false,
    fileChooserOpened: false,
    acceptedFiles: [],
  };
  let debuggerAttached = false;
  const ensureDebugger = async (): Promise<void> => {
    if (debuggerAttached) return;
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
    }
    debuggerAttached = true;
  };
  const pressKey = async (
    key: string,
    virtualKeyCode: number,
    text?: string,
  ): Promise<void> => {
    await ensureDebugger();
    const parameters = {
      key,
      code: key,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      ...(text ? { text } : {}),
    };
    // Control keys only need the raw keydown for their default action
    // (Tab focus traversal); activating a control with Enter additionally
    // needs the char event, so that dispatch carries the key text exactly
    // like a real keyboard pipeline (Playwright does the same).
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: text ? "keyDown" : "rawKeyDown",
    });
    await contents.debugger.sendCommand("Input.dispatchKeyEvent", {
      ...parameters,
      type: "keyUp",
    });
  };
  const tabUntilFocused = async (
    selector: string,
  ): Promise<{ presses: number; reached: boolean }> => {
    const maxPresses = 200;
    for (let presses = 0; presses < maxPresses; presses += 1) {
      const active = await evaluate<boolean>(
        `document.activeElement instanceof Element && document.activeElement.matches(${JSON.stringify(
          selector,
        )})`,
      );
      if (active) {
        return { presses, reached: true };
      }
      await pressKey("Tab", 9);
      await wait(15);
    }
    return { presses: maxPresses, reached: false };
  };
  // PR9C review fix: a computed outline only proves the style tree. The
  // focused screenshot must come from a frame that was produced AND
  // presented after focus landed, otherwise capturePage can hand back the
  // stale pre-focus frame (the review caught the ring rendered on the
  // previously focused control instead of the target). Double rAF
  // guarantees the renderer produced a frame containing the focused ring;
  // the compositor frame subscription — armed before the rAF wait, since
  // pending rAF callbacks force frame production — confirms such a frame
  // was presented. The active element is re-read at capture time so a
  // focus that silently moved between the probe and the capture becomes
  // recorded evidence instead of a hidden assumption.
  const waitForFocusedFrame = async (
    selector: string,
  ): Promise<SmokeFocusFrameEvidence> => {
    let frameSignal: SmokeFocusFrameEvidence["frameSignal"] =
      "beginFrameSubscription";
    const frameArrival = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (presented: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          contents.endFrameSubscription();
        } catch {
          // Not subscribed (the subscription API was unavailable).
        }
        resolve(presented);
      };
      const timeout = setTimeout(() => finish(false), 1_500);
      try {
        contents.beginFrameSubscription(() => finish(true));
      } catch {
        frameSignal = "unavailable";
        finish(false);
      }
    });
    const doubleRafCompleted = await evaluate<boolean>(`
      new Promise((resolve) => {
        let second = 0;
        const first = requestAnimationFrame(() => {
          second = requestAnimationFrame(() => resolve(true));
        });
        setTimeout(() => {
          cancelAnimationFrame(first);
          cancelAnimationFrame(second);
          resolve(false);
        }, 1_500);
      })`);
    const framePresented = await frameArrival;
    const active = await evaluate<{
      targetStillFocused: boolean;
      activeElementAtCapture: string;
    } | null>(`(function () {
      const target = document.querySelector(${JSON.stringify(selector)});
      const activeElement = document.activeElement;
      if (!(target instanceof Element)) {
        return null;
      }
      const describe = (element) =>
        element instanceof Element
          ? element.tagName.toLowerCase() +
            (typeof element.className === "string" && element.className
              ? "." + element.className.trim().split(/\s+/).join(".")
              : "")
          : "none";
      return {
        targetStillFocused: activeElement === target,
        activeElementAtCapture: describe(activeElement),
      };
    })()`);
    return {
      targetStillFocused: active?.targetStillFocused ?? false,
      activeElementAtCapture: active?.activeElementAtCapture ?? "unavailable",
      doubleRafCompleted,
      framePresented,
      frameSignal,
    };
  };
  const focusProbeScript = (selector: string, labelSelector?: string) => `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return null;
      const style = getComputedStyle(input);
      const label = ${
        labelSelector
          ? `document.querySelector(${JSON.stringify(labelSelector)})`
          : "null"
      };
      const labelStyle = label ? getComputedStyle(label) : null;
      const rect = input.getBoundingClientRect();
      const labelRect =
        label instanceof HTMLElement ? label.getBoundingClientRect() : null;
      const tabbables = Array.from(
        document.querySelectorAll(
          'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ),
      ).filter((element) => {
        const computed = getComputedStyle(element);
        return (
          computed.display !== "none" &&
          computed.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      });
      return {
        focused: document.activeElement === input,
        matchesFocusVisible: input.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        tabIndex: input.tabIndex,
        tabbableCount: tabbables.length,
        tabOrderIndex: tabbables.indexOf(input),
        hasFocus: document.hasFocus(),
        labelMatchesFocusWithin:
          label instanceof HTMLElement ? label.matches(":focus-within") : false,
        labelMatchesSiblingFocus:
          label instanceof HTMLElement &&
          label.previousElementSibling === input &&
          input.matches(":focus-visible"),
        labelOutlineStyle: labelStyle ? labelStyle.outlineStyle : null,
        labelOutlineWidth: labelStyle ? labelStyle.outlineWidth : null,
        labelOutlineColor: labelStyle ? labelStyle.outlineColor : null,
        targetRect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        labelRect: labelRect
          ? {
              x: labelRect.x,
              y: labelRect.y,
              width: labelRect.width,
              height: labelRect.height,
            }
          : null,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
      };
    })()`;
  // The smoke window is shown offscreen via showInactive(), so focusing the
  // web contents first is what makes the document hold real OS focus for
  // the Tab traversal and :focus-visible evidence below.
  contents.focus();
  if (view === "input-fields-automations-once") {
    const dateSelector = '.automation-dialog input[type="date"]';
    const tab = await tabUntilFocused(dateSelector);
    const focus = (await evaluate(
      focusProbeScript(dateSelector),
    )) as SmokeInputFieldsFocusProbe;
    // Capture only after the focused frame was produced and presented, and
    // prove the target still held focus at that exact moment.
    const focusRingCapture = await waitForFocusedFrame(dateSelector);
    if (artifacts.focusedScreenshot) {
      const image = await contents.capturePage();
      await writeFile(artifacts.focusedScreenshot, image.toPNG());
    }
    // F3: pixel-bind both on-disk captures with the repo-locked Electron
    // runtime instead of the verify script's system python3 + Pillow.
    const focusPixels = analyzeSmokeFocusPixels({
      defaultPath: artifacts.defaultScreenshot,
      focusedPath: artifacts.focusedScreenshot,
      ringColorSource: focus?.outlineColor ?? null,
      ringRect: focus?.targetRect ?? null,
      viewportWidth: focus?.viewport?.innerWidth ?? null,
    });
    const busy = await evaluate(`(async () => {
      const wait = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const form = document.querySelector("form.automation-dialog");
      const dialog = form?.closest('[role="dialog"]');
      const date = document.querySelector(${JSON.stringify(dateSelector)});
      const name = document.querySelector(
        '.automation-dialog [data-artemis-component="text-field"] ' +
          '[data-part="control"]',
      );
      const prompt = document.querySelector(".automation-dialog textarea");
      if (
        !(form instanceof HTMLFormElement) ||
        !(dialog instanceof HTMLElement) ||
        !(date instanceof HTMLInputElement) ||
        !(name instanceof HTMLInputElement) ||
        !(prompt instanceof HTMLTextAreaElement)
      ) {
        return { error: "once form controls missing" };
      }
      const inputSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      const textareaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      inputSetter?.call(name, "Artemis smoke once schedule");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      inputSetter?.call(date, "2099-06-15");
      date.dispatchEvent(new Event("input", { bubbles: true }));
      textareaSetter?.call(
        prompt,
        "Synthetic smoke prompt for the once date contract; this automation never runs.",
      );
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(150);
      const preSubmit = {
        formNoValidate: form.noValidate,
        dialogRole: dialog.getAttribute("role"),
        dialogAriaModal: dialog.getAttribute("aria-modal"),
        dateRequired: date.required,
        dateType: date.type,
        dateValue: date.value,
        dateDisabled: date.disabled,
        nameRequired: name.required,
        promptRequired: prompt.required,
      };
      const disabledTransitions = [];
      const observer = new MutationObserver(() => {
        const probe = document.querySelector(${JSON.stringify(dateSelector)});
        if (probe instanceof HTMLInputElement) {
          disabledTransitions.push(probe.disabled);
        }
      });
      observer.observe(form, {
        attributes: true,
        attributeFilter: ["disabled"],
        subtree: true,
      });
      form.requestSubmit();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!document.querySelector(".automation-dialog")) break;
        await wait(25);
      }
      observer.disconnect();
      return {
        preSubmit,
        disabledTransitions,
        busyDisabledObserved: disabledTransitions.includes(true),
        dialogClosedAfterSave: !document.querySelector(".automation-dialog"),
        errorMessage: document.querySelector(".automation-message")
          ?.textContent ?? null,
      };
    })()`);
    await evaluate(`(() => {
      window.__inputFieldsProbe = {
        view: ${JSON.stringify(view)},
        documentHasFocus: document.hasFocus(),
        tab: ${JSON.stringify(tab)},
        focus: ${JSON.stringify(focus ?? null)},
        focusRingCapture: ${JSON.stringify(focusRingCapture)},
        focusPixels: ${JSON.stringify(focusPixels)},
        busy: ${JSON.stringify(busy ?? null)},
        activation: null,
        pick: null,
      };
      return true;
    })()`);
    return;
  }
  if (view === "input-fields-settings-avatar") {
    const avatarSelector = ".profile-avatar-input";
    const tab = await tabUntilFocused(avatarSelector);
    const focus = (await evaluate(
      focusProbeScript(
        avatarSelector,
        '.settings-profile-avatar-actions [data-artemis-component="button"]',
      ),
    )) as SmokeInputFieldsFocusProbe;
    // Capture only after the focused frame was produced and presented, and
    // prove the avatar input still held focus at that exact moment.
    const focusRingCapture = await waitForFocusedFrame(avatarSelector);
    if (artifacts.focusedScreenshot) {
      const image = await contents.capturePage();
      await writeFile(artifacts.focusedScreenshot, image.toPNG());
    }
    // F3: same Electron-side pixel binding, against the public trigger
    // button's sibling-focus ring rect and color.
    const focusPixels = analyzeSmokeFocusPixels({
      defaultPath: artifacts.defaultScreenshot,
      focusedPath: artifacts.focusedScreenshot,
      ringColorSource: focus?.labelOutlineColor ?? null,
      ringRect: focus?.labelRect ?? null,
      viewportWidth: focus?.viewport?.innerWidth ?? null,
    });
    await evaluate(`(() => {
      window.__inputFieldsEnterClicks = 0;
      const input = document.querySelector(${JSON.stringify(avatarSelector)});
      input?.addEventListener("click", () => {
        window.__inputFieldsEnterClicks += 1;
      });
      return true;
    })()`);
    try {
      await ensureDebugger();
      await contents.debugger.sendCommand("Page.enable");
      await contents.debugger.sendCommand(
        "Page.setInterceptFileChooserDialog",
        { enabled: true, interceptAll: true },
      );
      activation.interceptionArmed = true;
    } catch (error) {
      activation.armError = String(error).slice(0, 240);
    }
    // The avatar save is a fast settings-store write, so the busy-state
    // observer must already be watching when the pick commits; arm it
    // before the intercepted chooser is satisfied.
    await evaluate(`(() => {
      window.__inputFieldsAvatarDisabled = [];
      const actions = document.querySelector(
        ".settings-profile-avatar-actions",
      );
      const observer = new MutationObserver(() => {
        const probe = document.querySelector(".profile-avatar-input");
        if (probe instanceof HTMLInputElement) {
          window.__inputFieldsAvatarDisabled.push(probe.disabled);
        }
      });
      if (actions) {
        observer.observe(actions, {
          attributes: true,
          attributeFilter: ["disabled"],
          subtree: true,
        });
        window.__inputFieldsAvatarObserver = observer;
      }
      return true;
    })()`);
    if (activation.interceptionArmed) {
      let chooserBackendNodeId: number | undefined;
      const chooserOpened = new Promise<boolean>((resolve) => {
        const handle = (_event: unknown, method: string, params?: unknown) => {
          if (method === "Page.fileChooserOpened") {
            const backendNodeId = (params as { backendNodeId?: number })
              ?.backendNodeId;
            if (typeof backendNodeId === "number") {
              chooserBackendNodeId = backendNodeId;
            }
            contents.debugger.removeListener("message", handle);
            resolve(true);
          }
        };
        contents.debugger.on("message", handle);
        void wait(4_000).then(() => {
          contents.debugger.removeListener("message", handle);
          resolve(false);
        });
      });
      await pressKey("Enter", 13, "\r");
      activation.entered = true;
      activation.fileChooserOpened = await chooserOpened;
      if (activation.fileChooserOpened) {
        const avatarPath = join(
          app.getPath("userData"),
          "fixtures",
          "input-fields",
          "avatar.png",
        );
        try {
          // Satisfy the intercepted chooser the way Playwright does: point
          // the chooser's input node at the synthetic fixture file, which
          // makes Chromium set the input's files and fire the real change
          // event through the normal pick path.
          await contents.debugger.sendCommand("DOM.setFileInputFiles", {
            files: [avatarPath],
            ...(typeof chooserBackendNodeId === "number"
              ? { backendNodeId: chooserBackendNodeId }
              : {}),
          });
          activation.acceptedFiles = ["avatar.png"];
        } catch (error) {
          activation.acceptError = String(error).slice(0, 240);
        }
      }
    }
    const pick = await evaluate(`(async () => {
      const wait = (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds));
      const input = document.querySelector(${JSON.stringify(avatarSelector)});
      if (!(input instanceof HTMLInputElement)) {
        return { error: "avatar input missing" };
      }
      const deadline = Date.now() + 6000;
      let settled = false;
      while (Date.now() < deadline) {
        const preview = document.querySelector(
          ".settings-profile-avatar-preview img",
        );
        const remove = document.querySelector(
          ".settings-profile-avatar-actions button",
        );
        if (preview && remove && !input.disabled) {
          settled = true;
          break;
        }
        await wait(25);
      }
      window.__inputFieldsAvatarObserver?.disconnect();
      const disabledTransitions =
        window.__inputFieldsAvatarDisabled ?? [];
      return {
        valueCleared: input.value === "",
        previewImagePresent:
          document.querySelector(".settings-profile-avatar-preview img") !==
          null,
        removePresent:
          document.querySelector(".settings-profile-avatar-actions button") !==
          null,
        disabledTransitions,
        busyDisabledObserved: disabledTransitions.includes(true),
        settled,
      };
    })()`);
    // Same presented-frame guarantee for the picked-state capture so that
    // artifact cannot regress to a pre-pick stale frame either.
    const pickedFrameCapture = await waitForFocusedFrame(avatarSelector);
    if (artifacts.pickedScreenshot) {
      const image = await contents.capturePage();
      await writeFile(artifacts.pickedScreenshot, image.toPNG());
    }
    const enterClicks = await evaluate<number>(
      "window.__inputFieldsEnterClicks ?? 0",
    );
    await evaluate(`(() => {
      window.__inputFieldsProbe = {
        view: ${JSON.stringify(view)},
        documentHasFocus: document.hasFocus(),
        tab: ${JSON.stringify(tab)},
        focus: ${JSON.stringify(focus ?? null)},
        focusRingCapture: ${JSON.stringify(focusRingCapture)},
        focusPixels: ${JSON.stringify(focusPixels)},
        busy: null,
        activation: ${JSON.stringify(activation)},
        pick: ${JSON.stringify(pick ?? null)},
        pickedFrameCapture: ${JSON.stringify(pickedFrameCapture)},
        enterClicks: ${JSON.stringify(enterClicks ?? 0)},
      };
      return true;
    })()`);
    return;
  }
  // An input-fields-* view without a driver branch must fail loudly here:
  // a silent return would exit clean with no probe written, and the verify
  // script would only report missing audit data far away from the cause.
  throw new Error(
    `Unknown input-fields smoke view: ${view}. Implemented views are input-fields-automations-once and input-fields-settings-avatar.`,
  );
}
