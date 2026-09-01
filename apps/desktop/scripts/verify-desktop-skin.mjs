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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
    load: async () => undefined,
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
const semanticSnapshot = () =>
  completeDesktopSkinTokenSnapshot(getComputedStyle(document.documentElement));
const snapshot = () => {
  const root = document.documentElement;
  const tokens = semanticSnapshot();
  const stateAnchor = document.querySelector(".environment-branch-search input");
  const portal = document.querySelector("#environment-branch-menu");
  const xterm = document.querySelector(".terminal-host .xterm");
  const xtermScreen = document.querySelector(".terminal-host .xterm-screen");
  const xtermRows = document.querySelector(".terminal-host .xterm-rows");
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
    state: {
      remembered: Boolean(references),
      inputSame: Boolean(references && stateAnchor === references.stateAnchor),
      inputValue: stateAnchor instanceof HTMLInputElement ? stateAnchor.value : null,
      selectionStart:
        stateAnchor instanceof HTMLInputElement ? stateAnchor.selectionStart : null,
      selectionEnd:
        stateAnchor instanceof HTMLInputElement ? stateAnchor.selectionEnd : null,
      inputFocused: document.activeElement === stateAnchor,
      portalSame: Boolean(references && portal === references.portal),
      portalInBody: Boolean(portal && portal.parentElement === document.body),
      portalInheritedCanvas: portal
        ? getComputedStyle(portal).getPropertyValue("--artemis-color-canvas").trim()
        : null,
      environmentOpen:
        document.querySelector(".environment-trigger")?.getAttribute("aria-expanded") === "true",
      branchMenuOpen: portal !== null,
      terminalActive:
        document.querySelector(".workspace-tab-pane.active .terminal-panel") !== null,
      xtermSame: Boolean(references && xterm === references.xterm),
      xtermScreenSame: Boolean(
        references && xtermScreen === references.xtermScreen,
      ),
      xtermRowsSame: Boolean(references && xtermRows === references.xtermRows),
      xtermContent:
        xtermRows?.textContent?.replace(/\\s+/gu, " ").trim() ?? null,
      xtermContentSame: Boolean(
        references &&
          (xtermRows?.textContent ?? "") === references.xtermContent,
      ),
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
const settle = () => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve)),
);

export function App() {
  renderEntrySnapshot ??= snapshot();
  useEffect(() => {
    globalThis.__ARTEMIS_SKIN_SMOKE__ = {
      renderEntrySnapshot,
      snapshot,
      remember() {
        references = {
          stateAnchor: document.querySelector(".environment-branch-search input"),
          portal: document.querySelector("#environment-branch-menu"),
          xterm: document.querySelector(".terminal-host .xterm"),
          xtermScreen: document.querySelector(".terminal-host .xterm-screen"),
          xtermRows: document.querySelector(".terminal-host .xterm-rows"),
          xtermContent:
            document.querySelector(".terminal-host .xterm-rows")?.textContent ?? "",
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
    };
    return () => {
      delete globalThis.__ARTEMIS_SKIN_SMOKE__;
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
      "const api: ArtemisApi = {",
      "let desktopSkinSmokeTerminalOpenCount = 0;\nlet desktopSkinSmokeRendererReadyCount = 0;\n\nconst api: ArtemisApi = {",
    )
    .replace(
      "rendererReady: () => ipcRenderer.send(IPC.rendererReady),",
      "rendererReady: () => {\n    desktopSkinSmokeRendererReadyCount += 1;\n    ipcRenderer.send(IPC.rendererReady);\n  },",
    )
    .replace(
      "openTerminal: (input) => ipcRenderer.invoke(IPC.terminalOpen, input),",
      "openTerminal: (input) => {\n    desktopSkinSmokeTerminalOpenCount += 1;\n    return ipcRenderer.invoke(IPC.terminalOpen, input);\n  },",
    )
    .replace(
      'contextBridge.exposeInMainWorld("artemis", api);',
      'contextBridge.exposeInMainWorld("__ARTEMIS_SKIN_SMOKE_PRELOAD__", {\n  terminalOpenCount: () => desktopSkinSmokeTerminalOpenCount,\n  rendererReadyCount: () => desktopSkinSmokeRendererReadyCount,\n});\ncontextBridge.exposeInMainWorld("artemis", api);',
    );
  assert(
    withCounters !== productionSource &&
      withCounters.includes("desktopSkinSmokeTerminalOpenCount += 1") &&
      withCounters.includes("desktopSkinSmokeRendererReadyCount += 1") &&
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
      `Runtime.evaluate failed: ${result.exceptionDetails.text ?? "unknown"}`,
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
      text: "export PS1='Artemis> '; clear",
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
      'document.querySelector(".terminal-host .xterm-rows")?.textContent?.includes("Artemis>")',
      "synthetic PTY prompt",
      15_000,
    );

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
      'Boolean(document.querySelector(".environment-branch-control > .environment-row"))',
      "real Environment branch control",
    );
    await evaluate(
      connection,
      'document.querySelector(".environment-branch-control > .environment-row")?.click()',
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
    const remembered = await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.remember()",
    );
    assert(
      remembered.state.portalInBody &&
        remembered.state.terminalActive &&
        remembered.state.inputFocused &&
        remembered.state.portalInheritedCanvas ===
          remembered.tokens?.["color.canvas"],
      `Real state anchors were incomplete: ${JSON.stringify(remembered.state)}`,
    );
    await screenshot(connection, "01-default.png");

    const stress = await evaluate(
      connection,
      'globalThis.__ARTEMIS_SKIN_SMOKE__.select("com.artemis.synthetic-stress")',
    );
    assert(stress.result.status === "applied", "Stress skin did not apply.");
    assert(
      stress.snapshot.tokens?.["color.canvas"] === "#fff0a6" &&
        stress.snapshot.state.portalSame &&
        stress.snapshot.state.portalInheritedCanvas === "#fff0a6",
      `Stress token did not compute: ${stress.snapshot.tokens?.["color.canvas"]}`,
    );
    await screenshot(connection, "02-stress.png");

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
      "Default did not restore after stress.",
    );
    await screenshot(connection, "03-returned-default.png");

    const fallbackCases = [];
    for (const [id, reason] of [
      ["com.artemis.smoke-unavailable", "unavailable"],
      ["com.artemis.smoke-load-failed", "load-failed"],
      ["com.artemis.missing", "unknown"],
      ["", "unknown"],
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
      fallbackCases.push({ id, ...outcome });
    }
    await screenshot(connection, "04-fallback-default.png");
    const finalSnapshot = await evaluate(
      connection,
      "globalThis.__ARTEMIS_SKIN_SMOKE__.snapshot()",
    );
    assert(
      finalSnapshot.state.inputSame &&
        finalSnapshot.state.portalSame &&
        finalSnapshot.state.xtermSame &&
        finalSnapshot.state.xtermScreenSame &&
        finalSnapshot.state.xtermRowsSame &&
        finalSnapshot.state.xtermContentSame &&
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
        explicitLight,
        explicitAfterSystemChange,
      },
      remembered,
      stress,
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
    assert(currentHash === committedHash, `${path} changed during CL1B.`);
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
