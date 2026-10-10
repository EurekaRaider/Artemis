import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";

const { _electron } = await import(
  process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright-core"
);
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(join(root, "apps/desktop/package.json"));
const out = process.argv[2] || verificationOutput("window-glass");
await mkdir(out, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "artemis-window-glass-"));
const data = join(temp, "user-data");
const project = join(temp, "project");
await Promise.all([mkdir(data), mkdir(project)]);
let storeModule = process.env.ARTEMIS_GLASS_STORE_MODULE;
if (!storeModule) {
  storeModule = join(out, "store.mjs");
  await require("esbuild").build({
    entryPoints: [join(root, "apps/desktop/src/main/settings/store.ts")],
    outfile: storeModule,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "silent",
  });
}
const { AppStore } = await import(pathToFileURL(storeModule).href);
const store = new AppStore(join(data, "artemis.sqlite"));
const now = "2026-10-10T04:00:00.000Z";
store.upsertProject({
  id: "glass-project",
  name: "Artemis",
  path: project,
  createdAt: now,
  updatedAt: now,
});
store.createThread({
  id: "glass-thread",
  projectId: "glass-project",
  title: "Windows 玻璃与面板验证",
  mode: "execute",
  target: "local",
  status: "completed",
  pinned: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
});
store.appendEvent("glass-user", "glass-thread", "glass-turn", {
  type: "user.message",
  messageId: "glass-message",
  text: "检查玻璃材质，以及左右面板的展开、收起和反向切换。",
});
store.close();
await writeFile(
  join(project, "README.md"),
  "# Artemis\n\nWindow material and motion fixture.\n",
);
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (
    key === "ELECTRON_RUN_AS_NODE" ||
    key === "ARTEMIS_DEV_SERVER_URL" ||
    key.startsWith("ARTEMIS_SMOKE_")
  )
    delete env[key];
}
const executablePath =
  process.env.ARTEMIS_GLASS_EXECUTABLE || require("electron");
const app = await _electron.launch({
  executablePath,
  args: [
    ...(process.env.ARTEMIS_GLASS_EXECUTABLE
      ? []
      : [join(root, "apps/desktop")]),
    `--user-data-dir=${data}`,
  ],
  env,
  timeout: 60000,
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = {
  platform: process.platform,
  profile: data,
  checks: [],
  themes: {},
  motion: {},
};
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 900),
  );
  await page
    .locator('.app-shell[data-renderer-ready="true"]')
    .waitFor({ timeout: 60000 });
  report.native = await app.evaluate(
    async ({ app, nativeTheme, BrowserWindow }) => ({
      versions: process.versions,
      architecture: process.arch,
      gpu: app.getGPUFeatureStatus(),
      theme: {
        reducedTransparency: nativeTheme.prefersReducedTransparency,
        highContrast: nativeTheme.shouldUseHighContrastColors,
        forcedColors: nativeTheme.inForcedColorsMode,
      },
      resizable: BrowserWindow.getAllWindows()[0].isResizable(),
      maximizable: BrowserWindow.getAllWindows()[0].isMaximizable(),
      menuBarVisible: BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
    }),
  );
  if (process.platform === "win32") {
    report.windowControls = await page.evaluate(() => ({
      visible: navigator.windowControlsOverlay.visible,
      width: navigator.windowControlsOverlay.getTitlebarAreaRect().width,
      reserved: parseFloat(
        getComputedStyle(document.querySelector(".workspace-header"))
          .paddingInlineEnd,
      ),
    }));
    assert.equal(report.windowControls.visible, true);
    assert.equal(report.native.menuBarVisible, false);
    assert.ok(report.windowControls.reserved >= 138);
  }
  report.systemReducedMotion = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  await page.evaluate(async () => {
    await window.artemis.setLanguage("zh-CN");
    await window.artemis.setTheme("light");
  });
  await page
    .getByText("Windows 玻璃与面板验证", { exact: true })
    .first()
    .click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  if (await page.locator(".environment-popover").count()) {
    await page.locator(".environment-trigger").click();
    await page.waitForTimeout(700);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const sample = async (side, reverse = false) =>
    page.evaluate(
      ({ side, reverse }) =>
        new Promise((resolve) => {
          const shell = document.querySelector(".app-shell");
          const dock = document.querySelector(
            '[data-artemis-component="workspace-dock"]',
          );
          const button = document.querySelector(
            side === "left" ? ".sidebar-collapse" : ".right-sidebar-toggle",
          );
          const element = side === "left" ? shell : dock;
          const started = performance.now();
          const frames = [];
          const read = () =>
            side === "left"
              ? parseFloat(getComputedStyle(shell).gridTemplateColumns)
              : dock.getBoundingClientRect().width;
          frames.push({ ms: 0, width: read() });
          const node = element;
          button.click();
          if (reverse) setTimeout(() => button.click(), 110);
          const tick = () => {
            const elapsed = performance.now() - started;
            frames.push({ ms: elapsed, width: read() });
            if (elapsed < 1000) requestAnimationFrame(tick);
            else
              resolve({
                frames,
                sameNode:
                  node ===
                  (side === "left"
                    ? document.querySelector(".app-shell")
                    : document.querySelector(
                        '[data-artemis-component="workspace-dock"]',
                      )),
                transition: getComputedStyle(element).transition,
                inert: dock.inert,
                state: dock.dataset.state,
              });
          };
          requestAnimationFrame(tick);
        }),
      { side, reverse },
    );
  for (const side of ["left", "right"]) {
    report.motion[side] = [];
    for (const reverse of [false, false, true]) {
      const result = await sample(side, reverse);
      report.motion[side].push(result);
      assert.equal(result.sameNode, true, `${side}: panel was remounted`);
      if (process.env.ARTEMIS_GLASS_ASSERT_MOTION === "1") {
        const widths = result.frames.map((frame) => frame.width);
        const min = Math.min(...widths),
          max = Math.max(...widths);
        assert.ok(
          widths.some((width) => width > min + 2 && width < max - 2),
          `${side}: no intermediate layout frames`,
        );
      }
    }
  }
  report.checks.push("normal motion: close, open, reverse; stable panel nodes");
  if (process.env.ARTEMIS_GLASS_EXTENDED === "1") {
    for (const [width, zoom] of [
      [980, 1],
      [1240, 1.25],
      [1440, 1.5],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, { width, zoom }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.webContents.setZoomFactor(zoom);
          window.setContentSize(width, 900);
        },
        { width, zoom },
      );
      await page.waitForTimeout(700);
      for (const side of ["left", "right"]) {
        const frames = (await sample(side)).frames;
        assert.ok(
          new Set(frames.map((frame) => frame.width)).size > 2,
          `${side}: motion at ${width}px / ${zoom}`,
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.setZoomFactor(1);
      window.setContentSize(1440, 900);
    });
    await page.evaluate(() => {
      if (document.querySelector(".app-shell").dataset.sidebarOpen !== "true")
        document.querySelector(".sidebar-collapse").click();
      if (
        document.querySelector('[data-artemis-component="workspace-dock"]')
          .dataset.state === "closed"
      )
        document.querySelector(".right-sidebar-toggle").click();
    });
    await page.waitForTimeout(800);
    report.resize = {};
    for (const [side, selector, delta] of [
      ["left", ".project-sidebar-resizer", 40],
      ["right", '[data-artemis-component="workspace-dock-resizer"]', -40],
    ]) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box, `${side} resizer not visible`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + delta,
        box.y + box.height / 2,
        { steps: 4 },
      );
      report.resize[side] = await page.evaluate((side) => {
        const element = document.querySelector(
          side === "left"
            ? ".app-shell"
            : '[data-artemis-component="workspace-dock"]',
        );
        return {
          transition: getComputedStyle(element).transition,
          state:
            side === "left"
              ? element.dataset.sidebarResizing
              : element.dataset.state,
        };
      }, side);
      assert.equal(report.resize[side].transition, "none");
      await page.mouse.up();
    }
    await page.mouse.move(800, 50);
    await page.locator(".sidebar-collapse").click();
    await page.waitForTimeout(400);
    await page.locator(".rail-brand").click();
    await page.locator(".right-sidebar-toggle").click();
    await page.waitForTimeout(700);
    await page.locator(".right-sidebar-toggle").click();
    await page.waitForTimeout(700);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].maximize(),
    );
    await page.waitForTimeout(300);
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
      true,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].unmaximize(),
    );
    report.checks.push(
      "980/1240/1440px; 100/125/150% zoom; pointer resize without transitions; real button clicks; maximize/restore",
    );
  }
  if (
    process.platform === "win32" &&
    process.env.ARTEMIS_GLASS_PREFERENCES_SCRIPT
  ) {
    // Renderer-only fixture: exercise the glass cutout without acquiring any
    // Computer Use target or invoking a control operation.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(
        "artemis:computer-state",
        {
          version: 1,
          state: "paused",
          threadId: "glass-thread",
          reason: "User paused control",
        },
      );
    });
    await page.locator('.computer-control[data-native-glass="true"]').waitFor();
    const transparency = (enabled) =>
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          process.env.ARTEMIS_GLASS_PREFERENCES_SCRIPT,
          "-Enabled",
          String(enabled),
        ],
        { stdio: "ignore", windowsHide: true },
      );
    const original = report.native.theme.reducedTransparency ? 0 : 1;
    try {
      transparency(0);
      await page.waitForFunction(
        () =>
          document.querySelector(".app-shell").dataset.windowMaterial ===
          "solid",
      );
      report.transparencyOff = await page
        .locator('.sidebar > [data-part="main"]')
        .evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          filter: getComputedStyle(element).backdropFilter,
        }));
      assert.equal(report.transparencyOff.filter, "none");
      await page.waitForFunction(
        () =>
          !document.querySelector(".computer-control").dataset.nativeGlass &&
          !document
            .querySelector(".conversation")
            .style.getPropertyValue("--computer-glass-mask"),
      );
      const motion = await sample("right");
      assert.ok(
        new Set(motion.frames.map((frame) => frame.width)).size > 2,
        "Transparency preference disabled motion",
      );
      transparency(1);
      await page.waitForFunction(
        () =>
          document.querySelector(".app-shell").dataset.windowMaterial ===
          "acrylic",
      );
      await page
        .locator('.computer-control[data-native-glass="true"]')
        .waitFor();
      report.checks.push(
        "real Windows transparency preference: live solid fallback, motion retained, Acrylic restored",
        "synthetic paused Computer Use UI: native cutout removed and restored with material",
      );
    } finally {
      transparency(original);
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.send(
          "artemis:computer-state",
          { version: 1, state: "idle" },
        ),
      );
    }
  }
  if (process.platform === "win32") {
    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const area = screen.getDisplayMatching(window.getBounds()).workArea;
      window.setBounds({
        x: area.x + 24,
        y: area.y + 24,
        width: Math.min(1440, area.width - 48),
        height: Math.min(900, area.height - 48),
      });
    });
    await page.evaluate(() => {
      if (document.querySelector(".app-shell").dataset.sidebarOpen !== "true")
        document.querySelector(".sidebar-collapse").click();
      if (
        document.querySelector('[data-artemis-component="workspace-dock"]')
          .dataset.state === "closed"
      )
        document.querySelector(".right-sidebar-toggle").click();
    });
    await page.waitForTimeout(800);
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => window.artemis.setTheme(theme), theme);
    await page.waitForTimeout(800);
    report.themes[theme] = await page.evaluate(() => {
      const shell = document.querySelector(".app-shell");
      const sidebar = document.querySelector('.sidebar > [data-part="main"]');
      const dock = document.querySelector(
        '[data-artemis-component="workspace-dock"]',
      );
      const properties = (element) => {
        const style = getComputedStyle(element);
        return {
          width: element.getBoundingClientRect().width,
          background: style.background,
          backdropFilter: style.backdropFilter,
          boxShadow: style.boxShadow,
          transition: style.transition,
        };
      };
      return {
        platform: shell.dataset.platform,
        material: shell.dataset.windowMaterial,
        shell: properties(shell),
        sidebar: properties(sidebar),
        dock: properties(dock),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(report.themes[theme].overflow, false);
    await page.screenshot({ path: join(out, `${theme}.png`) });
    if (process.platform === "win32") {
      const native = await app.evaluate(
        async ({ BrowserWindow, desktopCapturer, screen }) => {
          const { width, height } = screen.getPrimaryDisplay().size;
          const windowId = BrowserWindow.getAllWindows()[0]
            .getMediaSourceId()
            .split(":")[1];
          const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width, height },
          });
          const desktop = sources.find((source) =>
            source.id.startsWith("screen:"),
          );
          const window = sources.find(
            (source) =>
              source.id.startsWith("window:") &&
              source.id.split(":")[1] === windowId,
          );
          return {
            desktop: desktop.thumbnail.toPNG().toString("base64"),
            window: window.thumbnail.toPNG().toString("base64"),
          };
        },
      );
      await writeFile(
        join(out, `native-${theme}.png`),
        Buffer.from(native.desktop, "base64"),
      );
      await writeFile(
        join(out, `window-${theme}.png`),
        Buffer.from(native.window, "base64"),
      );
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  report.reducedMotion = await sample("left");
  assert.equal(report.reducedMotion.transition, "none");
  const reducedDock = await sample("right");
  assert.equal(reducedDock.transition, "none");
  report.checks.push("reduced motion: immediate layout, no animation");
  await page.emulateMedia({
    reducedMotion: "no-preference",
    forcedColors: "active",
  });
  report.forcedColors = await page
    .locator('.sidebar > [data-part="main"]')
    .evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      filter: getComputedStyle(element).backdropFilter,
    }));
  assert.equal(report.forcedColors.filter, "none");
  report.checks.push("forced colors: opaque web surfaces");
  assert.deepEqual(errors, []);
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      output: out,
      checks: report.checks,
      material: report.themes.light.material,
      errors,
    }),
  );
} catch (error) {
  report.error = String(error);
  await page.screenshot({ path: join(out, "failure.png") }).catch(() => {});
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await app.close();
}
