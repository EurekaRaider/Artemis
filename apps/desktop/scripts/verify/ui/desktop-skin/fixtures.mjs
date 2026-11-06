import { terminalContrastSnapshot } from "../../../dev/terminal-contrast.mjs";

export function fixtureModuleSource(paths) {
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

export function wrapperModuleSource(paths) {
  return `
import { useEffect } from "react";
import { App as ProductionApp } from ${JSON.stringify(paths.app)};
import {
  desktopSkinHost,
} from ${JSON.stringify(paths.bootstrap)};
import {
  completeDesktopSkinTokenSnapshot,
} from ${JSON.stringify(paths.resolver)};

const terminalContrastSnapshot = ${terminalContrastSnapshot.toString()};
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
  const terminalSurface = document.querySelector(
    '[data-artemis-component="terminal-surface"]',
  );
  const terminalHost = document.querySelector(
    '[data-artemis-component="terminal-host"]',
  );
  const appShell = document.querySelector(".app-shell");
  const opaqueSidebar = root.dataset.artemisContrast === "high" || matchMedia("(prefers-reduced-transparency: reduce), (forced-colors: active)").matches;
  const glassSidebar = !opaqueSidebar && root.dataset.material === "glass";
  const sidebarMain = document.querySelector(
    '[data-artemis-component="navigation-sidebar"] > [data-part="main"]',
  );
  const navigationSidebar = document.querySelector(
    '[data-artemis-component="navigation-sidebar"]',
  );
  const sidebarSurface = navigationSidebar?.dataset.state === "collapsed"
    ? navigationSidebar.querySelector('.sidebar-rail')
    : sidebarMain;
  const composerSurface = document.querySelector(
    '[data-artemis-component="composer-surface"]',
  );
  const workspace = document.querySelector(".workspace");
  const workspaceStyles =
    workspace instanceof HTMLElement ? getComputedStyle(workspace) : null;
  const environmentPanelWidth = Number.parseFloat(
    workspaceStyles?.getPropertyValue("--environment-panel-inline-size") ?? "",
  );
  const workspaceBounds =
    workspace instanceof HTMLElement ? workspace.getBoundingClientRect() : null;
  const conversationBounds = document.querySelector('[data-artemis-component="conversation-surface"]')?.getBoundingClientRect();
  const environmentBounds = document.querySelector('.environment-popover')?.getBoundingClientRect();
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
  const terminalRootStyle = getComputedStyle(root);
  const terminalBackgroundToken = terminalRootStyle
    .getPropertyValue("--artemis-color-terminal-background")
    .trim();
  const terminalForegroundToken = terminalRootStyle
    .getPropertyValue("--artemis-color-terminal-foreground")
    .trim();
  const terminalSurfaceStyle =
    terminalSurface instanceof HTMLElement
      ? getComputedStyle(terminalSurface)
      : null;
  const terminalHostStyle =
    terminalHost instanceof HTMLElement ? getComputedStyle(terminalHost) : null;
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
      opaqueSidebar,
      glassSidebar,
      sidebarOpen: appShell?.dataset.sidebarOpen ?? null,
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
      workspace: surfaceStyle(workspace, "--artemis-color-canvas"),
      sidebarParts: {
        main: navigationSidebar?.querySelectorAll(':scope > [data-part="main"]').length,
        rail: navigationSidebar?.querySelectorAll(':scope > [data-part="rail"]').length,
      },
      sidebar: surfaceStyle(
        sidebarSurface,
        glassSidebar
          ? "--nocturne-glass-sidebar"
          : "--artemis-color-background-sidebar",
      ),
      sidebarMaterialToken: getComputedStyle(root).getPropertyValue("--nocturne-glass-sidebar").trim(),
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
        minimumConversationWidth: workspaceBounds ? Math.min(320, workspaceBounds.width) : null,
        conversationWidth: conversationBounds?.width ?? null,
        panelInsideViewport: Boolean(environmentBounds && environmentBounds.left >= 0 && environmentBounds.right <= window.innerWidth && environmentBounds.top >= 0 && environmentBounds.bottom <= window.innerHeight),
      },
      terminalActive:
        document.querySelector(
          '[data-artemis-component="workspace-tab-pane"][data-state="active"] .terminal-panel',
        ) !== null,
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
      terminalReadability: terminalContrastSnapshot(),
      semanticTerminalPalettePresent:
        terminalBackgroundToken.length > 0 &&
        terminalForegroundToken.length > 0 &&
        terminalSurfaceStyle?.backgroundColor ===
          resolvedColor(terminalBackgroundToken) &&
        terminalSurfaceStyle?.color === resolvedColor(terminalForegroundToken) &&
        terminalHostStyle?.backgroundColor ===
          resolvedColor(terminalBackgroundToken) &&
        xtermStyle.toLowerCase().includes(terminalBackgroundToken.toLowerCase()) &&
        xtermStyle.toLowerCase().includes(terminalForegroundToken.toLowerCase()),
      terminalHeader:
        document.querySelector(".terminal-header")?.textContent
          ?.replace(/\\s+/gu, " ")
          .trim() ?? null,
      terminalCloseCount: preload?.terminalCloseCount() ?? null,
      terminalLastResize: preload?.terminalLastResize() ?? null,
      terminalOpenCount: preload?.terminalOpenCount() ?? null,
      terminalResizeCount: preload?.terminalResizeCount() ?? null,
      terminalWriteCount: preload?.terminalWriteCount() ?? null,
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

export function xtermWrapperModuleSource(path) {
  return `
import { Terminal as ProductionTerminal } from ${JSON.stringify(path)};

export class Terminal extends ProductionTerminal {
  constructor(options) {
    super(options);
    globalThis.__ARTEMIS_SKIN_SMOKE_XTERM__ = this;
  }
}
`;
}
