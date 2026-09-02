import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as asar from "@electron/asar";
import { build as esbuild } from "esbuild";

import {
  desktopSkinAsarLeakage,
  desktopSkinLeakage,
  desktopSkinPackagingConfigurationIssues,
} from "./desktop-skin-artifact-policy.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const requestedExpectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim();
const outputDirectory = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
    join(repositoryRoot, "artifacts", "desktop-skin"),
);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-desktop-skin-"),
);
const electronPath = createRequire(import.meta.url)("electron");
const smokeRendererDirectory = join(appDirectory, "dist-renderer-skin-smoke");
const rendererDirectory = join(appDirectory, "dist-renderer");
const electronDirectory = join(appDirectory, "dist-electron");
const smokePreloadSourcePath = join(
  appDirectory,
  "src/preload/.desktop-skin-smoke-preload.ts",
);
const screenshots = [];
const runtimeViewport = Object.freeze({ width: 1_420, height: 920 });
const conformanceMatrix = JSON.parse(
  await readFile(
    join(repositoryRoot, "apps/ui-gallery/src/conformance-matrix.json"),
    "utf8",
  ),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expectedRuntimeAxes = Object.freeze({
  skins: ["default", "stress"],
  themes: ["light", "dark"],
  contrasts: ["normal", "high"],
  directions: ["ltr", "rtl"],
  zoomFactors: [1, 2],
  reducedMotion: [false, true],
});
for (const [axis, expected] of Object.entries(expectedRuntimeAxes)) {
  assert(
    JSON.stringify(conformanceMatrix.runtimeAxes?.[axis]) ===
      JSON.stringify(expected),
    `Desktop runtime matrix axis ${axis} is incomplete.`,
  );
}
const runtimeEnvironments = expectedRuntimeAxes.directions.flatMap(
  (direction) =>
    expectedRuntimeAxes.zoomFactors.flatMap((zoomFactor) =>
      expectedRuntimeAxes.reducedMotion.map((reducedMotion) => ({
        direction,
        zoomFactor,
        reducedMotion,
      })),
    ),
);
const runtimeConfigurations = runtimeEnvironments.flatMap((environment) =>
  expectedRuntimeAxes.skins.flatMap((skin) =>
    expectedRuntimeAxes.themes.flatMap((theme) =>
      expectedRuntimeAxes.contrasts.map((contrast) => ({
        ...environment,
        skin,
        theme,
        contrast,
      })),
    ),
  ),
);
assert(
  runtimeConfigurations.length === 64,
  "Desktop runtime matrix must contain 64 vertices.",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeout ?? 300_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        `status=${String(result.status)} signal=${String(result.signal)}`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function filesBelow(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function treeHash(root) {
  const hash = createHash("sha256");
  for (const path of (await filesBelow(root)).sort()) {
    hash.update(relative(root, path));
    hash.update(await readFile(path));
  }
  return hash.digest("hex");
}

async function firstPath(root, name) {
  for (const path of await filesBelow(root)) {
    if (path.endsWith(name)) return path;
  }
  return undefined;
}

function fixtureModuleSource(paths) {
  return `
import artemisManifest from "@artemis/theme-artemis/manifest.json";
import {
  STRESS_SKIN_ID,
  stressSkinCss,
  stressSkinManifest,
} from ${JSON.stringify(paths.stressFixture)};
import {
  createDesktopSkinRegistry,
} from ${JSON.stringify(paths.resolver)};

const supportedStressManifest = Object.freeze({
  ...stressSkinManifest,
  capabilities: {
    ...stressSkinManifest.capabilities,
    densities: ["comfortable"],
  },
});
const unsupportedManifest = Object.freeze({
  ...supportedStressManifest,
  id: "com.artemis.smoke-unsupported",
  name: "Unsupported",
  capabilities: {
    ...supportedStressManifest.capabilities,
    densities: ["compact"],
  },
});
const failureManifest = (id, name) => Object.freeze({
  ...supportedStressManifest,
  id,
  name,
});
const loadStressCss = async () => {
  if (document.querySelector("style[data-artemis-skin-smoke-style]")) return;
  const style = document.createElement("style");
  style.dataset.artemisSkinSmokeStyle = "true";
  style.textContent = stressSkinCss;
  document.head.append(style);
};

export const productionDesktopSkinRegistry = createDesktopSkinRegistry([
  {
    manifest: artemisManifest,
    load: async () => {
      if (globalThis.__ARTEMIS_SKIN_SMOKE_FAIL_DEFAULT__) {
        throw new Error("dedicated smoke default rejection");
      }
    },
    ready: () => true,
  },
  {
    manifest: supportedStressManifest,
    load: loadStressCss,
    ready: () =>
      document.querySelector("style[data-artemis-skin-smoke-style]") !== null,
  },
  {
    manifest: failureManifest("com.artemis.smoke-unavailable", "Unavailable"),
    available: () => false,
    load: async () => undefined,
    ready: () => true,
  },
  {
    manifest: failureManifest("com.artemis.smoke-load-failed", "Load failed"),
    load: async () => {
      throw new Error("dedicated smoke load rejection");
    },
    ready: () => true,
  },
  {
    manifest: unsupportedManifest,
    load: async () => undefined,
    ready: () => true,
  },
]);

export { STRESS_SKIN_ID };
`;
}

function wrapperModuleSource(paths) {
  return `
import { useEffect } from "react";
import { App as ProductionApp } from ${JSON.stringify(paths.app)};
import {
  desktopSkinHost,
} from ${JSON.stringify(paths.bootstrap)};
import {
  completeDesktopSkinTokenSnapshot,
} from ${JSON.stringify(paths.resolver)};

const consoleEntries = [];
for (const level of ["warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...values) => {
    consoleEntries.push({
      level,
      text: values.map((value) =>
        value instanceof Error ? value.stack ?? value.message : String(value),
      ).join(" "),
    });
    original(...values);
  };
}
window.addEventListener("error", (event) => {
  consoleEntries.push({ level: "window-error", text: event.message });
});
window.addEventListener("unhandledrejection", (event) => {
  consoleEntries.push({
    level: "unhandledrejection",
    text: event.reason instanceof Error
      ? event.reason.stack ?? event.reason.message
      : String(event.reason),
  });
});

let renderEntrySnapshot;
let references;
let terminalReferences;
let composerReference;
const semanticSnapshot = () =>
  completeDesktopSkinTokenSnapshot(getComputedStyle(document.documentElement));
const resolvedColor = (value) => {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
};
const elementRect = (element) => {
  if (!(element instanceof HTMLElement)) return null;
  const bounds = element.getBoundingClientRect();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    right: bounds.right,
    bottom: bounds.bottom,
  };
};
const snapshot = () => {
  const root = document.documentElement;
  const tokens = semanticSnapshot();
  const environmentInput = document.querySelector(
    ".environment-branch-search input",
  );
  const stateAnchor = references?.stateAnchor ?? environmentInput;
  const composer = document.querySelector(".composer textarea");
  const portal = document.querySelector("#environment-branch-menu");
  const xterm = document.querySelector(".terminal-host .xterm");
  const xtermScreen = document.querySelector(".terminal-host .xterm-screen");
  const xtermRows = document.querySelector(".terminal-host .xterm-rows");
  const appShell = document.querySelector(".app-shell");
  const activityBar = document.querySelector(
    '[data-artemis-component="activity-bar"]',
  );
  const navigationSidebar = document.querySelector(
    '[data-artemis-component="navigation-sidebar"]',
  );
  const composerSurface = document.querySelector(
    '[data-artemis-component="composer-surface"]',
  );
  const workspace = document.querySelector(".workspace");
  const workspaceStyles =
    workspace instanceof HTMLElement ? getComputedStyle(workspace) : null;
  const environmentPanelWidth = Number.parseFloat(
    workspaceStyles?.getPropertyValue("--environment-panel-inline-size") ?? "",
  );
  const environmentLayoutGap = Number.parseFloat(
    workspaceStyles?.getPropertyValue("--environment-panel-layout-gap") ?? "",
  );
  const environmentMinimumConversationWidth = Number.parseFloat(
    workspaceStyles?.getPropertyValue(
      "--environment-panel-min-conversation-inline-size",
    ) ?? "",
  );
  const workspaceBounds =
    workspace instanceof HTMLElement ? workspace.getBoundingClientRect() : null;
  const surfaceStyle = (element, tokenName) => {
    if (!(element instanceof HTMLElement)) return null;
    const computed = getComputedStyle(element);
    const tokenValue = computed.getPropertyValue(tokenName).trim();
    return {
      tokenValue,
      resolvedTokenColor: resolvedColor(tokenValue),
      backgroundColor: computed.backgroundColor,
      color: computed.color,
    };
  };
  const xtermStyle = [...(xterm?.querySelectorAll("style") ?? [])]
    .map((style) => style.textContent ?? "")
    .join("\\n");
  const preload = globalThis.__ARTEMIS_SKIN_SMOKE_PRELOAD__;
  return {
    attrs: {
      skin: root.dataset.artemisSkin ?? null,
      theme: root.dataset.artemisTheme ?? null,
      contrast: root.dataset.artemisContrast ?? null,
      legacyTheme: root.dataset.theme ?? null,
    },
    environment: {
      direction: getComputedStyle(root).direction,
      zoomFactor: preload?.zoomFactor() ?? null,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      appShellTransitionDuration: appShell
        ? getComputedStyle(appShell).transitionDuration
        : null,
    },
    tokenCount: tokens ? Object.keys(tokens).length : 0,
    tokens,
    inlineSemanticTokens: [...root.style].filter((name) =>
      name.startsWith("--artemis-"),
    ),
    bodyAttrs: {
      skin: document.body.dataset.artemisSkin ?? null,
      theme: document.body.dataset.artemisTheme ?? null,
      contrast: document.body.dataset.artemisContrast ?? null,
    },
    surfaces: {
      counts: Object.fromEntries(
        [
          "application-shell",
          "application-shell-resizer",
          "activity-bar",
          "activity-bar-item",
          "navigation-sidebar",
          "composer-surface",
          "panel-header",
          "toolbar",
        ].map((name) => [
          name,
          document.querySelectorAll(
            '[data-artemis-component="' + name + '"]',
          ).length,
        ]),
      ),
      shell: surfaceStyle(appShell, "--artemis-color-canvas"),
      activity: surfaceStyle(
        activityBar,
        "--artemis-color-background-activity",
      ),
      sidebar: surfaceStyle(
        navigationSidebar,
        "--artemis-color-background-sidebar",
      ),
      composer: surfaceStyle(
        composerSurface,
        "--artemis-color-surface-composer",
      ),
      geometry: {
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        },
        shell: elementRect(appShell),
        activity: elementRect(activityBar),
        sidebar: elementRect(navigationSidebar),
        workspace: elementRect(workspace),
        composer: elementRect(composerSurface),
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        composerHorizontalOverflow:
          composerSurface instanceof HTMLElement
            ? composerSurface.scrollWidth - composerSurface.clientWidth
            : null,
      },
      structuralSkinMarkers: [
        ...document.body.querySelectorAll(
          "[data-skin-id], [data-artemis-skin], [class*='skin-']",
        ),
      ].map((element) => ({
        tag: element.tagName.toLowerCase(),
        className:
          typeof element.className === "string" ? element.className : null,
        skinId: element.getAttribute("data-skin-id"),
        artemisSkin: element.getAttribute("data-artemis-skin"),
      })),
    },
    state: {
      remembered: Boolean(references),
      inputSame: Boolean(references && stateAnchor === references.stateAnchor),
      inputValue:
        stateAnchor instanceof HTMLInputElement ||
        stateAnchor instanceof HTMLTextAreaElement
          ? stateAnchor.value
          : null,
      selectionStart:
        stateAnchor instanceof HTMLInputElement ||
        stateAnchor instanceof HTMLTextAreaElement
          ? stateAnchor.selectionStart
          : null,
      selectionEnd:
        stateAnchor instanceof HTMLInputElement ||
        stateAnchor instanceof HTMLTextAreaElement
          ? stateAnchor.selectionEnd
          : null,
      inputFocused: document.activeElement === stateAnchor,
      composerSame: Boolean(
        composerReference && composer === composerReference,
      ),
      composerValue:
        composer instanceof HTMLTextAreaElement ? composer.value : null,
      portalSame: Boolean(references && portal === references.portal),
      portalInBody: Boolean(portal && portal.parentElement === document.body),
      portalInheritedCanvas: portal
        ? getComputedStyle(portal).getPropertyValue("--artemis-color-canvas").trim()
        : null,
      portalDirection: portal ? getComputedStyle(portal).direction : null,
      environmentOpen:
        document.querySelector(".environment-trigger")?.getAttribute("aria-expanded") === "true",
      branchMenuOpen: portal !== null,
      environmentLayout: {
        workspaceWidth: workspaceBounds?.width ?? null,
        panelWidth: Number.isFinite(environmentPanelWidth)
          ? environmentPanelWidth
          : null,
        layoutGap: Number.isFinite(environmentLayoutGap)
          ? environmentLayoutGap
          : null,
        minimumConversationWidth: Number.isFinite(
          environmentMinimumConversationWidth,
        )
          ? environmentMinimumConversationWidth
          : null,
        conversationWidth:
          workspaceBounds &&
          Number.isFinite(environmentPanelWidth) &&
          Number.isFinite(environmentLayoutGap)
            ? workspaceBounds.width -
              environmentPanelWidth -
              environmentLayoutGap
            : null,
      },
      terminalActive:
        document.querySelector(".workspace-tab-pane.active .terminal-panel") !== null,
      xtermSame: Boolean(
        terminalReferences && xterm === terminalReferences.xterm,
      ),
      xtermScreenSame: Boolean(
        terminalReferences && xtermScreen === terminalReferences.xtermScreen,
      ),
      xtermRowsSame: Boolean(
        terminalReferences && xtermRows === terminalReferences.xtermRows,
      ),
      xtermContent:
        xtermRows?.textContent?.replace(/\\s+/gu, " ").trim() ?? null,
      xtermPromptPreserved: (xtermRows?.textContent ?? "").includes(
        "Artemis>",
      ),
      terminalPromptReceived:
        preload?.terminalData().includes("Artemis>") ?? false,
      legacyPalettePresent:
        xtermStyle.includes("#1f2023") &&
        xtermStyle.includes("#795e00") &&
        xtermStyle.includes("#6b5700") &&
        xtermStyle.includes("#c9dcf8"),
      terminalHeader:
        document.querySelector(".terminal-header")?.textContent
          ?.replace(/\\s+/gu, " ")
          .trim() ?? null,
      terminalOpenCount: preload?.terminalOpenCount() ?? null,
      rendererReadyCount: preload?.rendererReadyCount() ?? null,
    },
    consoleEntries: [...consoleEntries],
  };
};
const nextPaint = () => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)),
);
const settle = async () => {
  await nextPaint();
};

export function App() {
  renderEntrySnapshot ??= snapshot();
  useEffect(() => {
    globalThis.__ARTEMIS_SKIN_SMOKE__ = {
      renderEntrySnapshot,
      snapshot,
      remember(anchor = "environment") {
        const environmentInput = document.querySelector(
          ".environment-branch-search input",
        );
        const composer = document.querySelector(".composer textarea");
        references = {
          stateAnchor: anchor === "composer" ? composer : environmentInput,
          portal: document.querySelector("#environment-branch-menu"),
        };
        composerReference ??= composer;
        terminalReferences ??= {
          xterm: document.querySelector(".terminal-host .xterm"),
          xtermScreen: document.querySelector(".terminal-host .xterm-screen"),
          xtermRows: document.querySelector(".terminal-host .xterm-rows"),
        };
        return snapshot();
      },
      async select(id) {
        const result = await desktopSkinHost.selectSkin(id);
        await settle();
        return { result, snapshot: snapshot() };
      },
      async setTheme(theme) {
        const result = await desktopSkinHost.setTheme(theme);
        await settle();
        return { result, snapshot: snapshot() };
      },
      async setContrast(contrast) {
        const result = await desktopSkinHost.setContrast(contrast);
        await settle();
        return { result, snapshot: snapshot() };
      },
      async setDirection(direction) {
        document.documentElement.dir = direction;
        await settle();
        return snapshot();
      },
      async setZoomFactor(zoomFactor) {
        globalThis.__ARTEMIS_SKIN_SMOKE_PRELOAD__.setZoomFactor(zoomFactor);
        await settle();
        return snapshot();
      },
      async failDefault(value) {
        globalThis.__ARTEMIS_SKIN_SMOKE_FAIL_DEFAULT__ = value;
        await settle();
        return snapshot();
      },
    };
    return () => {
      delete globalThis.__ARTEMIS_SKIN_SMOKE__;
      delete globalThis.__ARTEMIS_SKIN_SMOKE_FAIL_DEFAULT__;
    };
  }, []);
  return <ProductionApp />;
}
`;
}

async function buildSmokePreload() {
  const productionSource = await readFile(
    join(appDirectory, "src/preload/preload.ts"),
    "utf8",
  );
  const withCounters = productionSource
    .replace(
      'import { contextBridge, ipcRenderer, webUtils } from "electron";',
      'import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";',
    )
    .replace(
      "const api: ArtemisApi = {",
      'let desktopSkinSmokeTerminalOpenCount = 0;\nlet desktopSkinSmokeRendererReadyCount = 0;\nlet desktopSkinSmokeTerminalData = "";\n\nconst api: ArtemisApi = {',
    )
    .replace(
      "rendererReady: () =>\n    ipcRenderer.send(IPC.rendererReady, {\n      contextIsolated: process.contextIsolated === true,\n      sandboxed: process.sandboxed === true,\n    }),",
      "rendererReady: () => {\n    desktopSkinSmokeRendererReadyCount += 1;\n    ipcRenderer.send(IPC.rendererReady, {\n      contextIsolated: process.contextIsolated === true,\n      sandboxed: process.sandboxed === true,\n    });\n  },",
    )
    .replace(
      "openTerminal: (input) => ipcRenderer.invoke(IPC.terminalOpen, input),",
      "openTerminal: (input) => {\n    desktopSkinSmokeTerminalOpenCount += 1;\n    return ipcRenderer.invoke(IPC.terminalOpen, input);\n  },",
    )
    .replace(
      "    ipcRenderer.on(IPC.terminalData, handler);",
      "    ipcRenderer.on(IPC.terminalData, (_event, value) => {\n      desktopSkinSmokeTerminalData = (desktopSkinSmokeTerminalData + value.data).slice(-16_384);\n    });\n    ipcRenderer.on(IPC.terminalData, handler);",
    )
    .replace(
      'contextBridge.exposeInMainWorld("artemis", api);',
      'contextBridge.exposeInMainWorld("__ARTEMIS_SKIN_SMOKE_PRELOAD__", {\n  terminalData: () => desktopSkinSmokeTerminalData,\n  terminalOpenCount: () => desktopSkinSmokeTerminalOpenCount,\n  rendererReadyCount: () => desktopSkinSmokeRendererReadyCount,\n  setZoomFactor: (value) => webFrame.setZoomFactor(value),\n  zoomFactor: () => webFrame.getZoomFactor(),\n});\ncontextBridge.exposeInMainWorld("artemis", api);',
    );
  assert(
    withCounters !== productionSource &&
      withCounters.includes("desktopSkinSmokeTerminalOpenCount += 1") &&
      withCounters.includes("desktopSkinSmokeTerminalData =") &&
      withCounters.includes("desktopSkinSmokeRendererReadyCount += 1") &&
      withCounters.includes("webFrame.setZoomFactor(value)") &&
      withCounters.includes("__ARTEMIS_SKIN_SMOKE_PRELOAD__"),
    "Could not instrument the temporary smoke preload.",
  );
  await writeFile(smokePreloadSourcePath, withCounters);
  await esbuild({
    bundle: true,
    entryPoints: [smokePreloadSourcePath],
    external: ["electron"],
    format: "cjs",
    logLevel: "info",
    outfile: join(electronDirectory, "preload.cjs"),
    platform: "node",
    target: "node24",
  });
}

class CdpConnection {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    webSocket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const webSocket = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      webSocket.addEventListener("open", resolvePromise, { once: true });
      webSocket.addEventListener("error", rejectPromise, { once: true });
    });
    return new CdpConnection(webSocket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`CDP ${method} timed out.`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
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

async function fetchJson(url, timeout = 1_500) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

async function waitForTarget(port) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find(
        (target) =>
          target.type === "page" && target.url?.includes("index.html"),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron has not opened its debugging endpoint yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Timed out waiting for the Desktop skin smoke page.");
}

async function evaluate(connection, expression) {
  const result = await connection.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      [
        `Runtime.evaluate failed: ${result.exceptionDetails.text ?? "unknown"}`,
        result.exceptionDetails.exception?.description,
        `Expression: ${expression}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.result?.value;
}

async function waitFor(connection, expression, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(connection, expression);
    if (last) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(
    `Timed out waiting for ${description}; last=${JSON.stringify(last)}`,
  );
}

async function screenshot(connection, name) {
  const clip = await evaluate(
    connection,
    `(() => {
      const bounds = document.querySelector(".workspace")?.getBoundingClientRect();
      return bounds
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 }
        : null;
    })()`,
  );
  assert(
    clip && clip.width > 0 && clip.height > 0,
    "Workspace screenshot clip is missing.",
  );
  const result = await connection.send("Page.captureScreenshot", {
    captureBeyondViewport: false,
    clip,
    format: "png",
  });
  const path = join(outputDirectory, name);
  const bytes = Buffer.from(result.data, "base64");
  assert(bytes.length > 10_000, `${name} is unexpectedly small.`);
  await writeFile(path, bytes);
  const record = { name, bytes: bytes.length, sha256: sha256(bytes) };
  screenshots.push(record);
  return record;
}

async function setReferenceSliceViewport(connection, width, height) {
  await connection.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height,
    mobile: false,
    screenHeight: height,
    screenWidth: width,
    width,
  });
  await evaluate(
    connection,
    `(async () => {
      const wait = (milliseconds) => new Promise((resolve) =>
        setTimeout(resolve, milliseconds),
      );
      const environment = document.querySelector(".environment-trigger");
      if (environment?.getAttribute("aria-expanded") === "true") {
        environment.click();
        await wait(350);
      }
      const sidebar = document.querySelector(
        '[data-artemis-component="activity-bar-item"][aria-expanded]',
      );
      if (sidebar?.getAttribute("aria-expanded") !== "true") {
        sidebar?.click();
        await wait(500);
      }
      const dock = document.querySelector(".right-sidebar-toggle");
      if (dock?.getAttribute("aria-expanded") === "true") {
        dock.click();
        await wait(600);
      }
      return true;
    })()`,
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
}

async function setRuntimeViewport(connection) {
  await connection.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: runtimeViewport.height,
    mobile: false,
    screenHeight: runtimeViewport.height,
    screenWidth: runtimeViewport.width,
    width: runtimeViewport.width,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
}

async function referenceSliceGeometry(connection) {
  return evaluate(
    connection,
    `(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return null;
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      };
      const controls = [
        ".composer-leading",
        ".composer-trailing",
        ".approval-policy-trigger",
        ".model-button",
        ".send-button",
      ].map((selector) => ({ selector, geometry: rect(selector) }));
      const headerControls = [
        ".status-pill",
        ".environment-trigger",
        ".left-sidebar-toggle",
        ".right-sidebar-toggle",
      ].map((selector) => ({ selector, geometry: rect(selector) }));
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
        },
        shell: rect('[data-artemis-component="application-shell"]'),
        activity: rect('[data-artemis-component="activity-bar"]'),
        sidebar: rect('[data-artemis-component="navigation-sidebar"]'),
        sidebarResizer: rect(
          '[data-artemis-component="application-shell-resizer"]',
        ),
        workspace: rect(".workspace"),
        workspaceContent: rect(".workspace-content"),
        conversation: rect(".conversation"),
        timeline: rect(".timeline-scroll"),
        composerWrap: rect(".composer-wrap"),
        composer: rect('[data-artemis-component="composer-surface"]'),
        toolbar: rect('[data-artemis-component="toolbar"].workspace-header'),
        controls,
        headerControls,
      };
    })()`,
  );
}

async function verifyReferenceSliceGeometry(connection) {
  const dispatchSidebarResizeKey = async (key) => {
    const right = key === "ArrowRight";
    await connection.send("Input.dispatchKeyEvent", {
      code: key,
      key,
      nativeVirtualKeyCode: right ? 124 : 123,
      type: "rawKeyDown",
      windowsVirtualKeyCode: right ? 39 : 37,
    });
    await connection.send("Input.dispatchKeyEvent", {
      code: key,
      key,
      nativeVirtualKeyCode: right ? 124 : 123,
      type: "keyUp",
      windowsVirtualKeyCode: right ? 39 : 37,
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
  };

  await setReferenceSliceViewport(connection, 1_050, 900);
  const compactInitial = await referenceSliceGeometry(connection);
  const initialSidebarWidth = Math.round(compactInitial.sidebar.width);
  assert(
    initialSidebarWidth === 252,
    `Compact resize fixture started at ${String(initialSidebarWidth)}px instead of 252px: ${JSON.stringify(compactInitial)}`,
  );
  await evaluate(
    connection,
    "document.querySelector('[data-artemis-component=\"application-shell-resizer\"]')?.focus()",
  );
  await waitFor(
    connection,
    "document.activeElement === document.querySelector('[data-artemis-component=\"application-shell-resizer\"]')",
    "compact viewport sidebar resizer focus",
  );
  await dispatchSidebarResizeKey("ArrowRight");
  const keyboardSidebarWidth = Math.min(420, initialSidebarWidth + 24);
  const keyboardState = await evaluate(
    connection,
    `(() => {
      const resizer = document.querySelector(
        '[data-artemis-component="application-shell-resizer"]',
      );
      const sidebar = document.querySelector(
        '[data-artemis-component="navigation-sidebar"]',
      );
      return {
        active: document.activeElement === resizer,
        ariaValue: resizer?.getAttribute("aria-valuenow"),
        sidebarWidth: sidebar?.getBoundingClientRect().width,
      };
    })()`,
  );
  assert(
    keyboardState.active &&
      keyboardState.ariaValue === String(keyboardSidebarWidth) &&
      Math.abs(keyboardState.sidebarWidth - keyboardSidebarWidth) <= 1,
    `Compact keyboard resize did not reach ${String(keyboardSidebarWidth)}px: ${JSON.stringify(keyboardState)}`,
  );
  const afterKeyboardResize = await referenceSliceGeometry(connection);
  assert(
    Math.abs(afterKeyboardResize.sidebar.width - keyboardSidebarWidth) <= 1 &&
      afterKeyboardResize.sidebarResizer &&
      afterKeyboardResize.viewport.width === 1_050,
    `Compact keyboard resize desynchronized: ${JSON.stringify(afterKeyboardResize)}`,
  );

  const pointerStart = afterKeyboardResize.sidebarResizer;
  const pointerX = pointerStart.left + pointerStart.width / 2;
  const pointerY = pointerStart.top + pointerStart.height / 2;
  await connection.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x: pointerX,
    y: pointerY,
  });
  await connection.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    type: "mouseMoved",
    x: pointerX + 48,
    y: pointerY,
  });
  await connection.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x: pointerX + 48,
    y: pointerY,
  });
  const pointerSidebarWidth = Math.min(420, keyboardSidebarWidth + 48);
  await waitFor(
    connection,
    `document.querySelector('[data-artemis-component="application-shell-resizer"]')?.getAttribute("aria-valuenow") === ${JSON.stringify(String(pointerSidebarWidth))}`,
    "compact viewport pointer sidebar resize",
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
  const afterPointerResize = await referenceSliceGeometry(connection);
  assert(
    Math.abs(afterPointerResize.sidebar.width - pointerSidebarWidth) <= 1,
    `Compact pointer resize desynchronized: ${JSON.stringify(afterPointerResize)}`,
  );
  const resetPointer = afterPointerResize.sidebarResizer;
  const resetX = resetPointer.left + resetPointer.width / 2;
  const resetY = resetPointer.top + resetPointer.height / 2;
  const resetDelta = initialSidebarWidth - pointerSidebarWidth;
  await connection.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    clickCount: 1,
    type: "mousePressed",
    x: resetX,
    y: resetY,
  });
  await connection.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 1,
    type: "mouseMoved",
    x: resetX + resetDelta,
    y: resetY,
  });
  await connection.send("Input.dispatchMouseEvent", {
    button: "left",
    buttons: 0,
    clickCount: 1,
    type: "mouseReleased",
    x: resetX + resetDelta,
    y: resetY,
  });
  await waitFor(
    connection,
    `document.querySelector('[data-artemis-component="application-shell-resizer"]')?.getAttribute("aria-valuenow") === ${JSON.stringify(String(initialSidebarWidth))}`,
    "reference sidebar width reset",
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
  const compactResize = {
    viewportWidth: 1_050,
    initial: compactInitial,
    keyboard: afterKeyboardResize,
    pointer: afterPointerResize,
  };

  const contentWidths = [935, 943, 949];
  const contentWidthCases = [];
  for (const contentWidth of contentWidths) {
    const workspaceFrameInlineChrome = 4;
    const requestedViewportWidth =
      46 + initialSidebarWidth + workspaceFrameInlineChrome + contentWidth;
    await setReferenceSliceViewport(connection, requestedViewportWidth, 900);
    let geometry = await referenceSliceGeometry(connection);
    const responsiveRailWidth = Math.round(geometry.activity.width);
    const viewportWidth =
      responsiveRailWidth +
      initialSidebarWidth +
      workspaceFrameInlineChrome +
      contentWidth;
    if (viewportWidth !== requestedViewportWidth) {
      await setReferenceSliceViewport(connection, viewportWidth, 900);
      geometry = await referenceSliceGeometry(connection);
    }
    assert(
      geometry.viewport.width === viewportWidth &&
        geometry.viewport.height === 900 &&
        [44, 46].includes(Math.round(geometry.activity.width)) &&
        Math.abs(geometry.sidebar.width - initialSidebarWidth) <= 1 &&
        Math.abs(
          geometry.workspace.width -
            (contentWidth + workspaceFrameInlineChrome),
        ) <= 1 &&
        Math.abs(geometry.workspaceContent.width - contentWidth) <= 1 &&
        Math.abs(geometry.conversation.width - contentWidth) <= 1 &&
        geometry.composer.width > 0 &&
        geometry.composer.width <= 960 &&
        geometry.viewport.documentScrollWidth <=
          geometry.viewport.documentClientWidth + 1 &&
        geometry.composer.scrollWidth <= geometry.composer.clientWidth + 1 &&
        geometry.controls.every(
          ({ geometry: control }) =>
            control &&
            control.width >= 24 &&
            control.height <= 48 &&
            control.scrollWidth <= control.clientWidth + 1,
        ),
      `Reference slice content-width geometry failed: ${JSON.stringify({ contentWidth, geometry })}`,
    );
    contentWidthCases.push({ contentWidth, viewportWidth, geometry });
  }

  await setReferenceSliceViewport(connection, 1440, 900);
  const before = await referenceSliceGeometry(connection);
  const transitions = await evaluate(
    connection,
    `(async () => {
      const wait = (milliseconds) => new Promise((resolve) =>
        setTimeout(resolve, milliseconds),
      );
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) return null;
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
      const nodes = {
        shell: document.querySelector('[data-artemis-component="application-shell"]'),
        activity: document.querySelector('[data-artemis-component="activity-bar"]'),
        sidebar: document.querySelector('[data-artemis-component="navigation-sidebar"]'),
        composer: document.querySelector('[data-artemis-component="composer-surface"]'),
      };
      let sidebarToggle = document.querySelector(
        '[data-artemis-component="activity-bar-item"][aria-expanded]',
      );
      if (sidebarToggle?.getAttribute("aria-expanded") === "true") {
        sidebarToggle.click();
      }
      await wait(50);
      const collapsedSidebar = document.querySelector(
        '[data-artemis-component="navigation-sidebar"]',
      );
      const collapsedSidebarControl = collapsedSidebar?.querySelector(
        "button, input, select, textarea, a[href], [tabindex]",
      );
      collapsedSidebarControl?.focus();
      const sidebarCollapsedInteractionBlocked =
        collapsedSidebar instanceof HTMLElement &&
        collapsedSidebar.hasAttribute("inert") &&
        document.activeElement !== collapsedSidebarControl;
      await wait(850);
      const sidebarClosed = {
        workspace: rect(".workspace"),
        sidebar: rect('[data-artemis-component="navigation-sidebar"]'),
        state: document
          .querySelector('[data-artemis-component="navigation-sidebar"]')
          ?.getAttribute("data-state"),
      };
      sidebarToggle = document.querySelector(
        '[data-artemis-component="activity-bar-item"][aria-expanded]',
      );
      if (sidebarToggle?.getAttribute("aria-expanded") !== "true") {
        sidebarToggle?.click();
      }
      await wait(900);
      const sidebarRestored = {
        workspace: rect(".workspace"),
        sidebar: rect('[data-artemis-component="navigation-sidebar"]'),
        state: document
          .querySelector('[data-artemis-component="navigation-sidebar"]')
          ?.getAttribute("data-state"),
      };
      let dockToggle = document.querySelector(".right-sidebar-toggle");
      if (dockToggle?.getAttribute("aria-expanded") !== "true") {
        dockToggle?.click();
      }
      await wait(900);
      const dockOpen = {
        timeline: rect(".timeline-scroll"),
        conversation: rect(".conversation"),
        resizer: rect(
          '[data-artemis-component="workspace-dock-resizer"]',
        ),
        dock: rect('[data-artemis-component="workspace-dock"]'),
      };
      let environment = document.querySelector(".environment-trigger");
      if (environment?.getAttribute("aria-expanded") !== "true") {
        environment?.click();
      }
      await wait(650);
      const environmentOpen = {
        timeline: rect(".timeline-scroll"),
        popover: rect(".environment-popover"),
      };
      environment = document.querySelector(".environment-trigger");
      if (environment?.getAttribute("aria-expanded") === "true") {
        environment.click();
      }
      await wait(650);
      dockToggle = document.querySelector(".right-sidebar-toggle");
      if (dockToggle?.getAttribute("aria-expanded") === "true") {
        dockToggle.click();
      }
      await wait(900);
      environment = document.querySelector(".environment-trigger");
      if (environment?.getAttribute("aria-expanded") === "true") {
        environment.click();
        await wait(650);
      }
      return {
        sameNodes: Object.entries(nodes).every(([name, node]) =>
          node === document.querySelector(
            name === "shell"
              ? '[data-artemis-component="application-shell"]'
              : name === "activity"
                ? '[data-artemis-component="activity-bar"]'
                : name === "sidebar"
                  ? '[data-artemis-component="navigation-sidebar"]'
                  : '[data-artemis-component="composer-surface"]',
          ),
        ),
        sidebarCollapsedInteractionBlocked,
        sidebarClosed,
        sidebarRestored,
        dockOpen,
        environmentOpen,
        environmentClosed:
          document
            .querySelector(".environment-trigger")
            ?.getAttribute("aria-expanded") !== "true",
        dockClosed:
          document
            .querySelector(".right-sidebar-toggle")
            ?.getAttribute("aria-expanded") !== "true",
      };
    })()`,
  );
  const after = await referenceSliceGeometry(connection);
  assert(
    before.viewport.width === 1440 &&
      before.viewport.height === 900 &&
      Math.abs(before.activity.width - 46) <= 1 &&
      Math.abs(before.sidebar.width - 252) <= 1 &&
      Math.abs(before.workspace.width - 1142) <= 1 &&
      before.headerControls.every(
        ({ geometry: control }) =>
          control &&
          control.top >= before.toolbar.top - 1 &&
          control.bottom <= before.toolbar.bottom + 1,
      ) &&
      transitions.sameNodes &&
      transitions.sidebarCollapsedInteractionBlocked &&
      transitions.sidebarClosed.state === "collapsed" &&
      transitions.sidebarClosed.workspace.width > before.workspace.width &&
      transitions.sidebarRestored.state === "ready" &&
      Math.abs(
        transitions.sidebarRestored.workspace.width - before.workspace.width,
      ) <= 1 &&
      Math.abs(
        transitions.dockOpen.timeline.right - transitions.dockOpen.resizer.left,
      ) <= 1 &&
      transitions.dockOpen.dock.width > 0 &&
      Math.abs(
        transitions.environmentOpen.timeline.left -
          transitions.dockOpen.timeline.left,
      ) <= 1 &&
      Math.abs(
        transitions.environmentOpen.timeline.right -
          transitions.dockOpen.timeline.right,
      ) <= 1 &&
      transitions.environmentOpen.popover.width > 0 &&
      transitions.environmentClosed &&
      transitions.dockClosed &&
      Math.abs(after.workspace.width - before.workspace.width) <= 1 &&
      after.viewport.documentScrollWidth <=
        after.viewport.documentClientWidth + 1,
    `Reference slice 1440x900 transitions failed: ${JSON.stringify({ before, transitions, after })}`,
  );
  await screenshot(connection, "05-reference-slice-1440x900.png");
  await connection.send("Emulation.clearDeviceMetricsOverride");
  return { before, transitions, after, compactResize, contentWidthCases };
}

async function rememberRuntimeState(connection, includePortal) {
  if (includePortal) await setRuntimeViewport(connection);
  await evaluate(
    connection,
    `(() => {
      const composer = document.querySelector(".composer textarea");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(composer, "matrix-preserved");
      composer?.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`,
  );
  await waitFor(
    connection,
    'document.querySelector(".composer textarea")?.value === "matrix-preserved"',
    "real controlled Composer state",
  );
  if (includePortal) {
    await evaluate(
      connection,
      `(() => {
        const trigger = document.querySelector(".environment-trigger");
        if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
        return true;
      })()`,
    );
    await waitFor(
      connection,
      `(() => {
        const trigger = document.querySelector(".environment-trigger");
        const popover = document.querySelector(".environment-popover");
        if (!(popover instanceof HTMLElement)) return false;
        const bounds = popover.getBoundingClientRect();
        return trigger?.getAttribute("aria-expanded") === "true" &&
          bounds.width > 0 && bounds.height > 0;
      })()`,
      "open real Environment panel",
    );
    await waitFor(
      connection,
      'Boolean(document.querySelector(".environment-branch-control > .environment-row"))',
      "real Environment branch control",
    );
    await evaluate(
      connection,
      `(() => {
        const trigger = document.querySelector(
          ".environment-branch-control > .environment-row",
        );
        if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
        return true;
      })()`,
    );
    await waitFor(
      connection,
      'document.querySelector(".environment-branch-control > .environment-row")?.getAttribute("aria-expanded") === "true"',
      "expanded real Environment branch control",
    );
    await waitFor(
      connection,
      'Boolean(document.querySelector("#environment-branch-menu"))',
      "real Environment createPortal node",
    );
    await waitFor(
      connection,
      'Boolean(document.querySelector(".environment-branch-search input"))',
      "real Environment portal input",
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    await evaluate(
      connection,
      `(() => {
        const input = document.querySelector(".environment-branch-search input");
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, "main");
        input?.dispatchEvent(new Event("input", { bubbles: true }));
        input?.focus();
        input?.setSelectionRange(1, 3);
        return true;
      })()`,
    );
    await waitFor(
      connection,
      'document.querySelector(".environment-branch-search input")?.value === "main"',
      "real controlled Environment input state",
    );
    await waitFor(
      connection,
      'document.activeElement === document.querySelector(".environment-branch-search input")',
      "real Environment input focus",
    );
  } else {
    await evaluate(
      connection,
      `(() => {
        const composer = document.querySelector(".composer textarea");
        composer?.focus();
        composer?.setSelectionRange(2, 8);
        return true;
      })()`,
    );
    await waitFor(
      connection,
      'document.activeElement === document.querySelector(".composer textarea")',
      "real Composer focus",
    );
  }
  return evaluate(
    connection,
    `globalThis.__ARTEMIS_SKIN_SMOKE__.remember(${JSON.stringify(includePortal ? "environment" : "composer")})`,
  );
}

async function driveElectron() {
  const port = 24_000 + Math.floor(Math.random() * 20_000);
  const userData = join(temporaryDirectory, "user-data");
  const environment = {
    ...process.env,
    ARTEMIS_SMOKE_LOCALE: "en",
    ARTEMIS_SMOKE_VIEW: "environment-branch-menu",
  };
  delete environment.ARTEMIS_DEV_SERVER_URL;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ARTEMIS_SMOKE_SCREENSHOT;
  delete environment.ARTEMIS_SMOKE_ACCESSIBILITY;
  const child = spawn(
    electronPath,
    [
      appDirectory,
      `--user-data-dir=${userData}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
    ],
    {
      cwd: appDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const appendOutput = (chunk) => {
    output += String(chunk);
    if (output.length > 80_000) output = output.slice(-80_000);
  };
  child.stdout.on("data", appendOutput);
  child.stderr.on("data", appendOutput);
  let connection;
  try {
    const target = await waitForTarget(port);
    connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    await connection.send("Runtime.enable");
    await connection.send("Page.enable");
    await connection.send("Page.bringToFront").catch(() => undefined);
    await waitFor(
      connection,
      "Boolean(globalThis.__ARTEMIS_SKIN_SMOKE__)",
      "dedicated compile-time smoke hook",
    );
    const renderEntry = await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.renderEntrySnapshot",
    );
    assert(
      renderEntry.tokenCount === 74,
      "First React render lacked 74 tokens.",
    );
    assert(
      renderEntry.attrs.skin === "com.artemis.default" &&
        ["light", "dark"].includes(renderEntry.attrs.theme) &&
        renderEntry.attrs.contrast === "normal" &&
        renderEntry.attrs.legacyTheme === null &&
        renderEntry.state.rendererReadyCount === 0,
      `First React render had incomplete attrs: ${JSON.stringify(renderEntry.attrs)}`,
    );

    await waitFor(
      connection,
      'document.querySelector(".thread-select")?.click() || true',
      "task selector click",
    );
    await waitFor(
      connection,
      'Boolean(document.querySelector(".composer textarea"))',
      "real task composer",
    );
    await setRuntimeViewport(connection);

    await connection.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    const systemLight = await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setTheme("system")',
    );
    assert(
      systemLight.result.status === "applied" &&
        systemLight.snapshot.attrs.theme === "light" &&
        systemLight.snapshot.attrs.legacyTheme === null &&
        systemLight.snapshot.tokenCount === 74,
      "System light bridge was incomplete.",
    );
    await connection.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await waitFor(
      connection,
      'document.documentElement.dataset.artemisTheme === "dark" && !document.documentElement.dataset.theme',
      "system dark bridge",
    );
    const systemDark = await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.snapshot()",
    );
    assert(
      systemDark.attrs.theme === "dark" &&
        systemDark.attrs.legacyTheme === null &&
        systemDark.tokenCount === 74,
      "System dark bridge was incomplete.",
    );
    await connection.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "dark" },
        { name: "prefers-contrast", value: "more" },
      ],
    });
    const systemHighContrast = await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setContrast("system")',
    );
    assert(
      systemHighContrast.result.status === "applied" &&
        systemHighContrast.snapshot.attrs.contrast === "high" &&
        systemHighContrast.snapshot.tokenCount === 74,
      "System high-contrast bridge was incomplete.",
    );
    await connection.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "dark" },
        { name: "prefers-contrast", value: "no-preference" },
      ],
    });
    await waitFor(
      connection,
      'document.documentElement.dataset.artemisContrast === "normal"',
      "system normal-contrast bridge",
    );
    const explicitLight = await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setTheme("light")',
    );
    assert(
      explicitLight.result.status === "applied" &&
        explicitLight.snapshot.attrs.theme === "light" &&
        explicitLight.snapshot.attrs.legacyTheme === "light" &&
        explicitLight.snapshot.tokenCount === 74,
      "Explicit light bridge was incomplete.",
    );
    await connection.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    const explicitAfterSystemChange = await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.snapshot()",
    );
    assert(
      explicitAfterSystemChange.attrs.theme === "light" &&
        explicitAfterSystemChange.attrs.legacyTheme === "light",
      "Explicit theme followed a system change.",
    );
    await connection.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setTheme("system")',
    );

    await connection.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "j",
      code: "KeyJ",
      modifiers: 2,
      windowsVirtualKeyCode: 74,
      nativeVirtualKeyCode: 74,
    });
    await connection.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "j",
      code: "KeyJ",
      modifiers: 2,
      windowsVirtualKeyCode: 74,
      nativeVirtualKeyCode: 74,
    });
    await waitFor(
      connection,
      'Boolean(document.querySelector(".terminal-host .xterm"))',
      "real xterm node",
      45_000,
    );
    await waitFor(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE_PRELOAD__.terminalOpenCount() === 1",
      "single native PTY open",
      45_000,
    );
    await waitFor(
      connection,
      'document.querySelector(".terminal-header span:last-child")?.textContent?.includes("desktop-user")',
      "native PTY descriptor",
      45_000,
    );
    await evaluate(
      connection,
      'document.querySelector(".xterm-helper-textarea")?.focus()',
    );
    await connection.send("Input.insertText", {
      text: "export PS1='Ar''temis> '; clear",
    });
    await connection.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await connection.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await waitFor(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE_PRELOAD__.terminalData().includes("Artemis>")',
      "synthetic PTY prompt in the real terminal data stream",
      15_000,
    );
    await waitFor(
      connection,
      'document.querySelector(".terminal-host .xterm-rows")?.textContent?.includes("Artemis>")',
      "initial rendered synthetic PTY prompt",
      15_000,
    );

    const remembered = await rememberRuntimeState(connection, true);
    assert(
      remembered.state.portalInBody &&
        remembered.state.terminalActive &&
        remembered.state.inputFocused &&
        remembered.state.composerSame &&
        remembered.state.composerValue === "matrix-preserved" &&
        remembered.surfaces?.geometry?.viewport?.width ===
          runtimeViewport.width &&
        remembered.surfaces?.geometry?.viewport?.height ===
          runtimeViewport.height &&
        remembered.state.environmentLayout.conversationWidth >=
          remembered.state.environmentLayout.minimumConversationWidth &&
        remembered.state.portalInheritedCanvas ===
          remembered.tokens?.["color.canvas"],
      `Real state anchors were incomplete: ${JSON.stringify(remembered.state)}`,
    );
    await screenshot(connection, "01-default.png");

    const expectedCanvas = {
      default: {
        light: { normal: "#f5f5f7", high: "#f5f5f7" },
        dark: { normal: "#1d1d1f", high: "#1d1d1f" },
      },
      stress: {
        light: { normal: "#fff0a6", high: "#ffffff" },
        dark: { normal: "#16002a", high: "#000000" },
      },
    };
    const skinIds = {
      default: "com.artemis.default",
      stress: "com.artemis.synthetic-stress",
    };
    const runtimeMatrix = [];
    let activeEnvironmentKey;
    for (const configuration of runtimeConfigurations) {
      const environmentKey = JSON.stringify([
        configuration.direction,
        configuration.zoomFactor,
        configuration.reducedMotion,
      ]);
      if (environmentKey !== activeEnvironmentKey) {
        await connection.send("Emulation.setEmulatedMedia", {
          features: [
            {
              name: "prefers-reduced-motion",
              value: configuration.reducedMotion ? "reduce" : "no-preference",
            },
          ],
        });
        await evaluate(
          connection,
          `globalThis.__ARTEMIS_SKIN_SMOKE__.setDirection(${JSON.stringify(configuration.direction)})`,
        );
        await evaluate(
          connection,
          `globalThis.__ARTEMIS_SKIN_SMOKE__.setZoomFactor(${String(configuration.zoomFactor)})`,
        );
        const includePortal = configuration.zoomFactor === 1;
        const environmentRemembered = await rememberRuntimeState(
          connection,
          includePortal,
        );
        assert(
          environmentRemembered.state.inputSame &&
            environmentRemembered.state.inputFocused &&
            environmentRemembered.state.composerSame &&
            environmentRemembered.state.composerValue === "matrix-preserved" &&
            environmentRemembered.state.xtermSame &&
            environmentRemembered.state.xtermScreenSame &&
            environmentRemembered.state.xtermRowsSame &&
            environmentRemembered.state.terminalPromptReceived &&
            environmentRemembered.state.terminalOpenCount === 1 &&
            (includePortal
              ? environmentRemembered.state.portalInBody
              : !environmentRemembered.state.portalInBody),
          `Could not establish real state for ${environmentKey}: ${JSON.stringify(environmentRemembered.state)}`,
        );
        activeEnvironmentKey = environmentKey;
      }
      await evaluate(
        connection,
        `globalThis.__ARTEMIS_SKIN_SMOKE__.setTheme(${JSON.stringify(configuration.theme)})`,
      );
      await evaluate(
        connection,
        `globalThis.__ARTEMIS_SKIN_SMOKE__.setContrast(${JSON.stringify(configuration.contrast)})`,
      );
      const outcome = await evaluate(
        connection,
        `globalThis.__ARTEMIS_SKIN_SMOKE__.select(${JSON.stringify(skinIds[configuration.skin])})`,
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
      const snapshot = await evaluate(
        connection,
        "globalThis.__ARTEMIS_SKIN_SMOKE__.snapshot()",
      );
      const canvas =
        expectedCanvas[configuration.skin][configuration.theme][
          configuration.contrast
        ];
      const usesPortalAnchor = configuration.zoomFactor === 1;
      const expectedInput = usesPortalAnchor ? "main" : "matrix-preserved";
      const expectedSelection = usesPortalAnchor ? [1, 3] : [2, 8];
      assert(
        outcome.result.status === "applied" &&
          snapshot.attrs.skin === skinIds[configuration.skin] &&
          snapshot.attrs.theme === configuration.theme &&
          snapshot.attrs.legacyTheme === configuration.theme &&
          snapshot.attrs.contrast === configuration.contrast &&
          snapshot.tokenCount === 74 &&
          snapshot.tokens?.["color.canvas"] === canvas,
        `Runtime mode failed: ${JSON.stringify({ configuration, outcome })}`,
      );
      assert(
        snapshot.environment.direction === configuration.direction &&
          Math.abs(
            Number(snapshot.environment.zoomFactor) - configuration.zoomFactor,
          ) < 0.001 &&
          snapshot.environment.reducedMotion === configuration.reducedMotion &&
          (configuration.reducedMotion
            ? snapshot.environment.appShellTransitionDuration === "0s"
            : snapshot.environment.appShellTransitionDuration !== "0s"),
        `Runtime environment failed: ${JSON.stringify({ configuration, environment: snapshot.environment })}`,
      );
      const expectedSurfaceCounts = {
        "application-shell": 1,
        "application-shell-resizer": 1,
        "activity-bar": 1,
        "activity-bar-item": 6,
        "navigation-sidebar": 1,
        "composer-surface": 1,
        "panel-header": 1,
        toolbar: 1,
      };
      assert(
        JSON.stringify(snapshot.surfaces?.counts) ===
          JSON.stringify(expectedSurfaceCounts),
        `Public surface identity failed: ${JSON.stringify({ configuration, surfaces: snapshot.surfaces })}`,
      );
      const surfaceTokenBindings = [
        [snapshot.surfaces?.shell, snapshot.tokens?.["color.canvas"]],
        [
          snapshot.surfaces?.activity,
          snapshot.tokens?.["color.background.activity"],
        ],
        [
          snapshot.surfaces?.sidebar,
          snapshot.tokens?.["color.background.sidebar"],
        ],
        [
          snapshot.surfaces?.composer,
          snapshot.tokens?.["color.surface.composer"],
        ],
      ];
      assert(
        surfaceTokenBindings.every(
          ([surface, token]) =>
            surface?.tokenValue === token &&
            surface?.backgroundColor === surface?.resolvedTokenColor,
        ),
        `Public surface token binding failed: ${JSON.stringify({ configuration, bindings: surfaceTokenBindings })}`,
      );
      assert(
        snapshot.surfaces?.geometry?.horizontalOverflow <= 1 &&
          snapshot.surfaces?.geometry?.composerHorizontalOverflow <= 1 &&
          snapshot.surfaces?.geometry?.shell?.width > 0 &&
          snapshot.surfaces?.geometry?.activity?.width > 0 &&
          snapshot.surfaces?.geometry?.sidebar?.width > 0 &&
          snapshot.surfaces?.geometry?.workspace?.width > 0 &&
          snapshot.surfaces?.geometry?.composer?.width > 0 &&
          snapshot.surfaces?.structuralSkinMarkers?.length === 0,
        `Public surface geometry or structural skin isolation failed: ${JSON.stringify({ configuration, surfaces: snapshot.surfaces })}`,
      );
      assert(
        snapshot.state.inputSame &&
          snapshot.state.composerSame &&
          snapshot.state.composerValue === "matrix-preserved" &&
          snapshot.state.xtermSame &&
          snapshot.state.xtermScreenSame &&
          snapshot.state.xtermRowsSame &&
          snapshot.state.terminalPromptReceived &&
          snapshot.state.inputValue === expectedInput &&
          snapshot.state.selectionStart === expectedSelection[0] &&
          snapshot.state.selectionEnd === expectedSelection[1] &&
          snapshot.state.inputFocused &&
          (usesPortalAnchor
            ? snapshot.state.portalSame &&
              snapshot.state.portalInBody &&
              snapshot.state.portalInheritedCanvas === canvas &&
              snapshot.state.portalDirection === configuration.direction
            : !snapshot.state.portalInBody) &&
          snapshot.state.terminalOpenCount === 1,
        `Runtime state changed: ${JSON.stringify({ configuration, state: snapshot.state, geometry: snapshot.surfaces?.geometry })}`,
      );
      assert(
        snapshot.inlineSemanticTokens.length === 0 &&
          Object.values(snapshot.bodyAttrs).every((value) => value === null) &&
          snapshot.consoleEntries.length === 0,
        `Runtime isolation failed: ${JSON.stringify({ configuration, inlineSemanticTokens: snapshot.inlineSemanticTokens, bodyAttrs: snapshot.bodyAttrs, consoleEntries: snapshot.consoleEntries })}`,
      );
      runtimeMatrix.push({
        ...configuration,
        skinId: snapshot.attrs.skin,
        canvas,
        transitionDuration: snapshot.environment.appShellTransitionDuration,
        surfaces: snapshot.surfaces,
      });
      if (
        configuration.skin === "stress" &&
        configuration.theme === "light" &&
        configuration.contrast === "normal" &&
        configuration.direction === "ltr" &&
        configuration.zoomFactor === 1 &&
        !configuration.reducedMotion
      ) {
        await screenshot(connection, "02-stress.png");
      }
    }
    assert(
      runtimeMatrix.length === 64,
      "Electron did not traverse 64 vertices.",
    );

    await connection.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "light" },
        { name: "prefers-contrast", value: "no-preference" },
        { name: "prefers-reduced-motion", value: "no-preference" },
      ],
    });
    await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setDirection("ltr")',
    );
    await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.setZoomFactor(1)",
    );
    const referenceSlice = await verifyReferenceSliceGeometry(connection);
    const fallbackRemembered = await rememberRuntimeState(connection, true);
    assert(
      fallbackRemembered.state.portalInBody &&
        fallbackRemembered.state.inputFocused &&
        fallbackRemembered.state.composerSame &&
        fallbackRemembered.state.composerValue === "matrix-preserved" &&
        fallbackRemembered.state.xtermSame &&
        fallbackRemembered.state.terminalPromptReceived &&
        fallbackRemembered.state.terminalOpenCount === 1,
      `Could not establish fallback state: ${JSON.stringify(fallbackRemembered.state)}`,
    );
    await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setTheme("light")',
    );
    await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.setContrast("normal")',
    );
    const returnedDefault = await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.select("com.artemis.default")',
    );
    assert(
      returnedDefault.result.status === "applied" &&
        returnedDefault.snapshot.attrs.skin === "com.artemis.default" &&
        returnedDefault.snapshot.state.portalSame &&
        returnedDefault.snapshot.state.portalInheritedCanvas ===
          returnedDefault.snapshot.tokens?.["color.canvas"],
      "Default did not restore after the runtime matrix.",
    );
    await screenshot(connection, "03-returned-default.png");

    const fallbackCases = [];
    for (const [id, reason] of [
      ["com.artemis.missing", "unknown"],
      ["com.artemis.smoke-unavailable", "unavailable"],
      ["com.artemis.smoke-unsupported", "unsupported"],
      ["com.artemis.smoke-load-failed", "load-failed"],
    ]) {
      const outcome = await evaluate(
        connection,
        `globalThis.__ARTEMIS_SKIN_SMOKE__.select(${JSON.stringify(id)})`,
      );
      assert(
        outcome.result.status === "fallback" &&
          outcome.result.reason === reason &&
          outcome.snapshot.attrs.skin === "com.artemis.default" &&
          outcome.snapshot.tokenCount === 74 &&
          outcome.snapshot.state.portalSame &&
          outcome.snapshot.state.portalInheritedCanvas ===
            outcome.snapshot.tokens?.["color.canvas"],
        `Fallback was incomplete for ${JSON.stringify(id)}.`,
      );
      fallbackCases.push({ id, reason, ...outcome });
    }
    await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.failDefault(true)",
    );
    const defaultFatal = await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.select("com.artemis.default")',
    );
    assert(
      defaultFatal.result.status === "fatal" &&
        defaultFatal.result.activeSkinId === "com.artemis.default" &&
        defaultFatal.snapshot.attrs.skin === "com.artemis.default" &&
        defaultFatal.snapshot.tokenCount === 74 &&
        defaultFatal.snapshot.state.portalSame &&
        defaultFatal.snapshot.state.portalInheritedCanvas ===
          defaultFatal.snapshot.tokens?.["color.canvas"],
      `Default-fatal handling was incomplete: ${JSON.stringify(defaultFatal)}`,
    );
    fallbackCases.push({
      id: "com.artemis.default",
      reason: "default-fatal",
      ...defaultFatal,
    });
    await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.failDefault(false)",
    );
    assert(
      JSON.stringify(fallbackCases.map(({ reason }) => reason)) ===
        JSON.stringify(conformanceMatrix.fallbackCases),
      "Electron fallback coverage diverged from the Gallery contract.",
    );
    await screenshot(connection, "04-fallback-default.png");
    const finalSnapshot = await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.snapshot()",
    );
    assert(
      finalSnapshot.state.inputSame &&
        finalSnapshot.state.portalSame &&
        finalSnapshot.state.composerSame &&
        finalSnapshot.state.composerValue === "matrix-preserved" &&
        finalSnapshot.state.xtermSame &&
        finalSnapshot.state.xtermScreenSame &&
        finalSnapshot.state.xtermRowsSame &&
        finalSnapshot.state.terminalPromptReceived &&
        finalSnapshot.state.legacyPalettePresent &&
        finalSnapshot.state.inputValue === "main" &&
        finalSnapshot.state.selectionStart === 1 &&
        finalSnapshot.state.selectionEnd === 3 &&
        finalSnapshot.state.inputFocused &&
        finalSnapshot.state.terminalOpenCount === 1,
      `Skin transitions remounted or reset real state: ${JSON.stringify(finalSnapshot.state)}`,
    );
    assert(
      finalSnapshot.inlineSemanticTokens.length === 0 &&
        Object.values(finalSnapshot.bodyAttrs).every((value) => value === null),
      "Skin host leaked inline tokens or body attributes.",
    );
    assert(
      finalSnapshot.consoleEntries.length === 0,
      `Unexpected Renderer console output: ${JSON.stringify(finalSnapshot.consoleEntries)}`,
    );
    assert(
      Number.isInteger(finalSnapshot.state.rendererReadyCount) &&
        finalSnapshot.state.rendererReadyCount >= 1,
      `rendererReady count was ${String(finalSnapshot.state.rendererReadyCount)}.`,
    );

    await connection.send("Browser.close").catch(() => undefined);
    return {
      renderEntry,
      bridge: {
        systemLight,
        systemDark,
        systemHighContrast,
        explicitLight,
        explicitAfterSystemChange,
      },
      remembered,
      runtimeMatrix,
      referenceSlice,
      returnedDefault,
      fallbackCases,
      finalSnapshot,
      electronOutputTail: output.slice(-4_000),
      launchArguments: [
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-gpu-sandbox",
        "--use-angle=swiftshader",
        "--remote-debugging-port=<isolated>",
        "--remote-allow-origins=*",
      ],
    };
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `Electron exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}`,
        "--- Electron output tail ---",
        output.slice(-8_000),
      ].join("\n"),
    );
  } finally {
    connection?.close();
    if (child.exitCode === null && child.signal === null) child.kill("SIGKILL");
  }
}

async function standardArtifactEvidence() {
  const rendererFindings = await desktopSkinLeakage(rendererDirectory);
  const electronFindings = await desktopSkinLeakage(electronDirectory);
  assert(
    rendererFindings.length === 0,
    `Standard dist-renderer leaked smoke content: ${JSON.stringify(rendererFindings)}`,
  );
  assert(
    electronFindings.length === 0,
    `Standard dist-electron leaked smoke content: ${JSON.stringify(electronFindings)}`,
  );
  const packageManifest = JSON.parse(
    await readFile(join(appDirectory, "package.json"), "utf8"),
  );
  const configurationIssues =
    desktopSkinPackagingConfigurationIssues(packageManifest);
  assert(
    configurationIssues.length === 0,
    `Desktop package configuration leaked smoke inputs: ${JSON.stringify(configurationIssues)}`,
  );
  return {
    rendererFindings,
    electronFindings,
    configurationIssues,
    rendererHash: await treeHash(rendererDirectory),
    electronHash: await treeHash(electronDirectory),
  };
}

async function packageAndScan() {
  const packageOutput = join(temporaryDirectory, "package");
  run("npm", ["run", "build"], {
    cwd: appDirectory,
    timeout: 600_000,
    env: { ...process.env, ARTEMIS_PACKAGE_BUILD: "1" },
  });
  const builder = join(
    repositoryRoot,
    "node_modules",
    "electron-builder",
    "cli.js",
  );
  const arch = process.arch === "arm64" ? "--arm64" : "--x64";
  run(
    process.execPath,
    [
      builder,
      "--dir",
      "--mac",
      arch,
      "--publish",
      "never",
      `--config.directories.output=${packageOutput}`,
    ],
    {
      cwd: appDirectory,
      timeout: 600_000,
      env: {
        ...process.env,
        ARTEMIS_PACKAGE_BUILD: "1",
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
      },
    },
  );
  const archivePath = await firstPath(packageOutput, "/app.asar");
  assert(archivePath, "Packaged Electron app.asar was not found.");
  const archiveFindings = desktopSkinAsarLeakage(asar, archivePath);
  assert(
    archiveFindings.length === 0,
    `Packaged app.asar leaked smoke content: ${JSON.stringify(archiveFindings)}`,
  );
  const unpackedPath = `${archivePath}.unpacked`;
  const unpackedFindings = existsSync(unpackedPath)
    ? await desktopSkinLeakage(unpackedPath)
    : [];
  assert(
    unpackedFindings.length === 0,
    `Packaged app.asar.unpacked leaked smoke content: ${JSON.stringify(unpackedFindings)}`,
  );
  const extraResourcesPath = join(dirname(archivePath), "resources");
  const resourceFindings = existsSync(extraResourcesPath)
    ? await desktopSkinLeakage(extraResourcesPath)
    : [];
  assert(
    resourceFindings.length === 0,
    `Packaged extra resources leaked smoke content: ${JSON.stringify(resourceFindings)}`,
  );
  const archiveBytes = await readFile(archivePath);
  return {
    archive: relative(packageOutput, archivePath),
    archiveBytes: archiveBytes.length,
    archiveSha256: sha256(archiveBytes),
    archiveFindings,
    unpackedPresent: existsSync(unpackedPath),
    unpackedFindings,
    resourceFindings,
  };
}

async function unchangedSafetyPathEvidence() {
  const paths = [
    "apps/desktop/src/renderer/TerminalPanel.tsx",
    "apps/desktop/src/main/main.ts",
    "apps/desktop/src/preload/preload.ts",
    "apps/desktop/src/shared/api.ts",
  ];
  const evidence = [];
  for (const path of paths) {
    const current = await readFile(join(repositoryRoot, path));
    const committed = run("git", ["show", `HEAD:${path}`]).stdout;
    const currentHash = sha256(current);
    const committedHash = sha256(Buffer.from(committed));
    assert(
      currentHash === committedHash,
      `${path} changed during the skin conformance milestone.`,
    );
    evidence.push({ path, sha256: currentHash, unchangedFromHead: true });
  }
  return evidence;
}

await mkdir(outputDirectory, { recursive: true });
let electronEvidence;
let standardEvidence;
let packageEvidence;
let smokeRendererHash;
let failure;
let expectedHead;

try {
  const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const dirty = run("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]).stdout.trim();
  assert(
    dirty.length === 0,
    `Exact-head verifier requires a clean checkout:\n${dirty}`,
  );
  expectedHead = requestedExpectedHead || head;
  assert(
    head === expectedHead,
    `Expected HEAD ${expectedHead}, received ${head}.`,
  );
  run("npm", ["run", "build"], { cwd: appDirectory, timeout: 600_000 });

  const fixtureRegistry = join(temporaryDirectory, "skin-smoke-registry.ts");
  const fixtureWrapper = join(temporaryDirectory, "skin-smoke-app.tsx");
  const fixturePaths = {
    app: resolve(appDirectory, "src/renderer/App.tsx"),
    bootstrap: resolve(appDirectory, "src/renderer/desktop-skin-bootstrap.ts"),
    resolver: resolve(appDirectory, "src/renderer/desktop-skin.ts"),
    stressFixture: resolve(
      repositoryRoot,
      "apps/ui-gallery/src/stress-skin-fixture.mjs",
    ),
  };
  await writeFile(fixtureRegistry, fixtureModuleSource(fixturePaths));
  await writeFile(fixtureWrapper, wrapperModuleSource(fixturePaths));
  run("npx", ["vite", "build", "--config", "vite.skin-smoke.config.ts"], {
    cwd: appDirectory,
    timeout: 300_000,
    env: {
      ...process.env,
      ARTEMIS_SKIN_SMOKE_APP_WRAPPER: fixtureWrapper,
      ARTEMIS_SKIN_SMOKE_REGISTRY: fixtureRegistry,
    },
  });
  const dedicatedFindings = await desktopSkinLeakage(smokeRendererDirectory);
  const dedicatedMarkers = new Set(
    dedicatedFindings.map((finding) => finding.marker),
  );
  assert(
    dedicatedMarkers.has("com.artemis.synthetic-stress") &&
      dedicatedMarkers.has("__ARTEMIS_SKIN_SMOKE"),
    `Dedicated renderer did not contain both fixture and hook evidence: ${JSON.stringify(dedicatedFindings)}`,
  );
  smokeRendererHash = await treeHash(smokeRendererDirectory);
  await rm(rendererDirectory, { recursive: true, force: true });
  await rename(smokeRendererDirectory, rendererDirectory);

  await buildSmokePreload();
  electronEvidence = await driveElectron();
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  try {
    await rm(smokeRendererDirectory, { recursive: true, force: true });
    await rm(smokePreloadSourcePath, { force: true });
    run("npm", ["run", "build"], { cwd: appDirectory, timeout: 600_000 });
    standardEvidence = await standardArtifactEvidence();
  } catch (restoreError) {
    const message =
      restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
    failure = new Error(
      [failure?.message, `Standard build restore/scan failed: ${message}`]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

try {
  if (failure) throw failure;
  assert(electronEvidence, "NO_RESULT: Electron evidence was not produced.");
  try {
    packageEvidence = await packageAndScan();
  } finally {
    run("npm", ["run", "build"], {
      cwd: appDirectory,
      timeout: 600_000,
    });
    standardEvidence = await standardArtifactEvidence();
  }
  run(process.execPath, [
    join(scriptDirectory, "test-desktop-skin-artifact-policy.mjs"),
  ]);
  const safetyPaths = await unchangedSafetyPathEvidence();
  const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  assert(
    head === expectedHead,
    "HEAD changed during Desktop skin verification.",
  );
  const dirty = run("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]).stdout.trim();
  assert(dirty.length === 0, `Verification left the checkout dirty:\n${dirty}`);
  const report = {
    status: "PASS",
    head,
    expectedHead,
    buildKind:
      "dedicated compile-time renderer aliases with temporary fixtures",
    noSandboxFallback: true,
    smokeRendererHash,
    standard: standardEvidence,
    package: packageEvidence,
    screenshots,
    electron: electronEvidence,
    safetyPaths,
  };
  const reportPath = join(outputDirectory, "desktop-skin-audit.json");
  await writeFile(reportPath, JSON.stringify(report, undefined, 2));
  const reportBytes = await readFile(reportPath);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        head,
        audit: reportPath,
        auditSha256: sha256(reportBytes),
        screenshots,
        package: packageEvidence,
      },
      undefined,
      2,
    ),
  );
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  await writeFile(
    join(outputDirectory, "desktop-skin-audit.failure.json"),
    JSON.stringify(
      {
        status: "FAIL",
        message,
        standard: standardEvidence,
        screenshots,
      },
      undefined,
      2,
    ),
  );
  throw error;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
