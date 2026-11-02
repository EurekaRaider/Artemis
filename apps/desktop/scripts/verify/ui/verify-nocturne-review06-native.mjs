import { build } from "esbuild";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-06/local",
);
const profile = join(output, "native-profile");
await mkdir(profile, { recursive: true });
const workspace = join(profile, "workspace");
await mkdir(workspace, { recursive: true });
await build({
  entryPoints: [join(desktop, "src/main/settings/store.ts")],
  outfile: join(profile, "store.mjs"),
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  logLevel: "silent",
});
const { AppStore } = await import(
  pathToFileURL(join(profile, "store.mjs")).href
);
const store = new AppStore(join(profile, "artemis.sqlite"));
const now = new Date().toISOString(),
  projectId = "3d16813a-65cc-4f35-9e16-cb74d4dc39bd";
const cases = [
  {
    id: "e59ea82c-775a-4a3f-87ab-62c11ac31f3b",
    title: "Review06 local link fixture",
    archived: false,
  },
  {
    id: "4c891818-ae97-4ccd-8445-799c01ddca5a",
    title: "Review06 archived link fixture",
    archived: true,
  },
];
store.upsertProject({
  id: projectId,
  name: "Native UI fixture",
  path: workspace,
  createdAt: now,
  updatedAt: now,
});
for (const item of cases) {
  if (!store.getThread(item.id))
    store.createThread({
      ...item,
      projectId,
      mode: "plan",
      target: "local",
      status: "idle",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
}
store.close();
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    version: 1,
    addedModels: [],
    credentials: {},
    providers: {},
    language: "zh-CN",
    theme: "dark",
    material: "glass",
    preventSleep: false,
  }),
);
const require = createRequire(import.meta.url),
  { _electron } = require("playwright-core");
const executablePath = join(
  desktop,
  "release/mac-arm64/Artemis.app/Contents/MacOS/Artemis",
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ARTEMIS_DEV_SERVER_URL;
for (const key of Object.keys(env))
  if (key.startsWith("ARTEMIS_SMOKE_")) delete env[key];
const application = await _electron.launch({
  executablePath,
  args: [`--user-data-dir=${profile}`],
  env,
  timeout: 90000,
});
console.log(
  JSON.stringify({
    state: "packaged process launched",
    pid: application.process().pid,
    executablePath,
    profile,
  }),
);
application
  .process()
  .stdout?.on("data", (chunk) => process.stdout.write(chunk));
application
  .process()
  .stderr?.on("data", (chunk) => process.stderr.write(chunk));
const page = await application
  .firstWindow({ timeout: 90000 })
  .catch(async (error) => {
    await writeFile(
      join(output, "native-startup-failure.json"),
      JSON.stringify(
        {
          error: String(error),
          pid: application.process().pid,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    await application.close().catch(() => {});
    throw error;
  });
await page.waitForSelector('[data-renderer-ready="true"]', { timeout: 90000 });
const checks = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const baseline = await page.evaluate(async () => {
  const snapshot = await window.artemis.getSnapshot();
  return {
    ids: snapshot.threads.map((thread) => thread.id).sort(),
    events: await Promise.all(
      snapshot.threads.map(async (thread) => ({
        id: thread.id,
        events: await window.artemis.getThreadEvents(thread.id),
      })),
    ),
  };
});
const metadata = await application.evaluate(
  ({ app, BrowserWindow, nativeTheme }) => ({
    packaged: app.isPackaged,
    arch: process.arch,
    platform: process.platform,
    executable: process.execPath,
    profile: app.getPath("userData"),
    protocol: app.isDefaultProtocolClient("artemis"),
    reducedTransparency: nativeTheme.prefersReducedTransparency,
    pid: process.pid,
    windowId: BrowserWindow.getAllWindows()[0].id,
    mediaSourceId: BrowserWindow.getAllWindows()[0].getMediaSourceId(),
    bounds: BrowserWindow.getAllWindows()[0].getBounds(),
  }),
);
checks.push({
  name: "actual packaged arm64 application",
  actual: metadata,
  pass:
    metadata.packaged &&
    metadata.arch === "arm64" &&
    metadata.platform === "darwin",
});
checks.push({
  name: "packaged app registered as the macOS task URL handler",
  actual: metadata.protocol,
  pass: metadata.protocol,
});
const missing = "artemis://thread/5529457e-48aa-4e0d-938e-d77e3d9c250e";
const html = `<!doctype html><meta charset="utf-8"><title>Artemis local link verification</title><body style="font:18px system-ui;padding:32px"><h1>Artemis 本地任务链接验证</h1>${cases.map((item) => `<p><a target="_blank" href="artemis://thread/${item.id}">${item.archived ? "打开本地归档任务" : "打开本地任务"}</a></p>`).join("")}<p><a target="_blank" href="${missing}">打开不存在的任务</a></p><p>只使用本地合成任务；没有上传、发布或模型调用。</p></body>`;
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
  response.end(html);
});
await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
const url = `http://127.0.0.1:${server.address().port}`;
await writeFile(
  join(output, "native-state.json"),
  JSON.stringify({ url, metadata, cases }, null, 2),
);
console.log(
  JSON.stringify({ state: "waiting for actual browser clicks", url, metadata }),
);
// A separate sandboxed HTML test window supplies real pointer clicks. Only its
// three known links are handed to macOS; it never calls Artemis IPC or its URL
// callback directly. This is not a Safari/Chrome certification.
const browserEntry = join(profile, "link-browser.cjs");
await writeFile(
  browserEntry,
  `const {app,BrowserWindow,shell}=require('electron');app.setPath('userData',${JSON.stringify(join(profile, "link-browser-profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:540,height:440,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});const allowed=new Set(${JSON.stringify([...cases.map((item) => `artemis://thread/${item.id}`), missing])});w.webContents.setWindowOpenHandler(({url})=>{if(allowed.has(url))void shell.openExternal(url);return {action:'deny'};});w.loadURL(${JSON.stringify(url)});});`,
);
const linkBrowser = await _electron.launch({
  executablePath: require("electron"),
  args: [browserEntry],
  env,
});
const linkPage = await linkBrowser.firstWindow();
await linkPage
  .getByRole("heading", { name: "Artemis 本地任务链接验证" })
  .waitFor();
checks.push({
  name: "external input path",
  actual:
    "real HTML pointer click → Electron shell.openExternal → macOS URL handler → packaged Artemis",
  pass: true,
});
try {
  for (const item of cases) {
    await linkPage.locator(`a[href="artemis://thread/${item.id}"]`).click();
    await page.waitForFunction(
      (title) =>
        document
          .querySelector(".workspace-header")
          ?.textContent.includes(title),
      item.title,
      { timeout: 300000 },
    );
    await page.screenshot({
      path: join(
        output,
        `native-${item.archived ? "archived" : "local"}-link.png`,
      ),
      scale: "css",
    });
    checks.push({
      name: `OS link opened ${item.archived ? "archived" : "local"} task`,
      pass: true,
    });
    if (item.archived)
      checks.push({
        name: "archived task remains read only",
        actual: await page.locator(".composer textarea:enabled").count(),
        pass: !(await page.locator(".composer textarea:enabled").count()),
      });
    console.log(`OPENED ${item.archived ? "archived" : "local"}`);
    await writeFile(
      join(output, "native-progress.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
  }
  await linkPage.locator(`a[href="${missing}"]`).click();
  await page
    .getByText("找不到这个任务", { exact: true })
    .waitFor({ timeout: 300000 });
  checks.push({ name: "missing task notification", pass: true });
  const noticePosition = await page
    .locator(".transient-notice")
    .evaluate((notice) => {
      const rect = notice.getBoundingClientRect(),
        footer = document
          .querySelector(".archived-readonly")
          .getBoundingClientRect();
      return {
        notice: rect.toJSON(),
        footer: footer.toJSON(),
        insideComposerColumn: !!notice.closest(".composer-wrap"),
        gap: footer.top - rect.bottom,
        headerTop: document
          .querySelector(".workspace-header")
          .getBoundingClientRect().top,
      };
    });
  checks.push({
    name: "missing-task notice stays above read-only footer",
    actual: noticePosition,
    pass:
      noticePosition.insideComposerColumn &&
      Math.abs(noticePosition.gap - 10) <= 1 &&
      noticePosition.headerTop < 1,
  });
  const after = await page.evaluate(async () => {
    const snapshot = await window.artemis.getSnapshot();
    return {
      ids: snapshot.threads.map((thread) => thread.id).sort(),
      events: await Promise.all(
        snapshot.threads.map(async (thread) => ({
          id: thread.id,
          events: await window.artemis.getThreadEvents(thread.id),
        })),
      ),
    };
  });
  checks.push({
    name: "links did not create, run, send or append task events",
    actual: after,
    pass: JSON.stringify(after) === JSON.stringify(baseline),
  });
  await page.screenshot({
    path: join(output, "native-missing-link.png"),
    scale: "css",
  });
  await linkBrowser.close();
  const materials = [];
  for (const variant of [
    { theme: "dark", locale: "zh-CN" },
    { theme: "light", locale: "zh-CN" },
    { theme: "dark", locale: "ar" },
  ]) {
    await application.evaluate(
      ({ BrowserWindow }, id) =>
        BrowserWindow.fromId(id).setContentSize(1440, 900),
      metadata.windowId,
    );
    await page.evaluate(async ({ theme, locale }) => {
      await window.artemis.setLanguage(locale);
      await window.artemis.setTheme(theme);
    }, variant);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      ({ locale, theme }) => {
        const sidebar = document.querySelector('.sidebar > [data-part="main"]');
        if (!sidebar) return false;
        const background = getComputedStyle(sidebar).backgroundColor;
        return (
          document.documentElement.lang === locale &&
          document.documentElement.dir === (locale === "ar" ? "rtl" : "ltr") &&
          background.includes(theme === "dark" ? "14, 15, 19" : "244, 245, 248")
        );
      },
      variant,
      { timeout: 15000 },
    );
    const state = await page.locator(".app-shell").evaluate((shell) => ({
      language: document.documentElement.lang,
      material: shell.dataset.windowMaterial,
      direction: document.documentElement.dir,
      sidebar: document
        .querySelector(".sidebar")
        .getBoundingClientRect()
        .toJSON(),
      sidebarBackground: getComputedStyle(
        document.querySelector('.sidebar > [data-part="main"]'),
      ).backgroundColor,
    }));
    checks.push({
      name: `native material locale/theme ${variant.locale}/${variant.theme}`,
      actual: state,
      pass:
        state.language === variant.locale &&
        state.direction === (variant.locale === "ar" ? "rtl" : "ltr") &&
        state.material === "vibrancy",
    });
    for (const [name, color] of [
      ["blue", "#2563a8"],
      ["gold", "#b86b20"],
    ]) {
      await application.evaluate(
        async ({ app, BrowserWindow }, { color, id }) => {
          const main = BrowserWindow.fromId(id);
          const bounds = main.getBounds();
          app.__reviewBackdrop ??= new BrowserWindow({
            ...bounds,
            frame: false,
            focusable: false,
            show: false,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
            },
          });
          app.__reviewBackdrop.setBounds(bounds);
          await app.__reviewBackdrop.loadURL(
            `data:text/html,<body style="margin:0;background:${color.replace("#", "%23")};height:100vh"></body>`,
          );
          app.__reviewBackdrop.showInactive();
          main.show();
          main.focus();
        },
        { color, id: metadata.windowId },
      );
      await page.waitForTimeout(600);
      const captured = await application.evaluate(
        async ({ BrowserWindow, desktopCapturer, screen }, windowId) => {
          const window = BrowserWindow.fromId(windowId);
          if (!window.isFocused())
            throw new Error(
              "Native app lost foreground focus before compositor capture",
            );
          if (
            !window.webContents.getURL().includes("/dist-renderer/index.html")
          )
            throw new Error(
              "Capture target is not the packaged Artemis renderer",
            );
          const id = window.getMediaSourceId();
          const sources = await desktopCapturer.getSources({
            types: ["window"],
            thumbnailSize: { width: 1440, height: 900 },
          });
          const source = sources.find(
            (item) =>
              item.id === id || item.id.split(":")[1] === id.split(":")[1],
          );
          if (!source || source.thumbnail.isEmpty())
            throw new Error(
              "The OS did not supply the packaged window's composited thumbnail",
            );
          const bounds = window.getBounds(),
            display = screen.getDisplayMatching(bounds);
          const desktops = await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: {
              width: display.size.width * display.scaleFactor,
              height: display.size.height * display.scaleFactor,
            },
          });
          const desktop =
            desktops.find((item) => item.display_id === String(display.id)) ??
            (desktops.length === 1 ? desktops[0] : undefined);
          if (!desktop || desktop.thumbnail.isEmpty())
            throw new Error(
              "The OS did not supply the composited display capture",
            );
          return {
            size: source.thumbnail.getSize(),
            sourceId: source.id,
            png: source.thumbnail.toPNG().toString("base64"),
            desktopPng: desktop.thumbnail.toPNG().toString("base64"),
            bounds,
            display: {
              bounds: display.bounds,
              scaleFactor: display.scaleFactor,
            },
          };
        },
        metadata.windowId,
      );
      if (
        captured.sourceId.split(":")[1] !== metadata.mediaSourceId.split(":")[1]
      )
        throw new Error(
          "OS capture source changed to a different native window",
        );
      const { createCanvas, loadImage } = require("@napi-rs/canvas");
      const image = await loadImage(Buffer.from(captured.png, "base64"));
      const canvas = createCanvas(image.width, image.height),
        context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const colors = new Set();
      for (let y = 40; y < image.height; y += 16)
        for (let x = 10; x < image.width; x += 16)
          colors.add([...context.getImageData(x, y, 1, 1).data].join(","));
      if (colors.size < 30)
        throw new Error(
          "Native screenshot lacks the application's visible UI; reject a uniform backdrop capture",
        );
      // Persist only our app's rectangle, never the rest of the user's desktop.
      const desktop = await loadImage(
        Buffer.from(captured.desktopPng, "base64"),
      );
      const sx = desktop.width / captured.display.bounds.width,
        sy = desktop.height / captured.display.bounds.height;
      const crop = {
        x: (captured.bounds.x - captured.display.bounds.x) * sx,
        y: (captured.bounds.y - captured.display.bounds.y) * sy,
        width: captured.bounds.width * sx,
        height: captured.bounds.height * sy,
      };
      if (
        crop.x < 0 ||
        crop.y < 0 ||
        crop.x + crop.width > desktop.width ||
        crop.y + crop.height > desktop.height
      )
        throw new Error(
          "The native app is clipped by the display; compositor proof must show the whole app",
        );
      const composited = createCanvas(
        captured.bounds.width,
        captured.bounds.height,
      );
      const compositedContext = composited.getContext("2d");
      compositedContext.drawImage(
        desktop,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        composited.width,
        composited.height,
      );
      const screenColors = new Set();
      for (let y = 40; y < composited.height; y += 16)
        for (let x = 10; x < composited.width; x += 16)
          screenColors.add(
            [...compositedContext.getImageData(x, y, 1, 1).data].join(","),
          );
      if (screenColors.size < 30)
        throw new Error(
          "Composited display capture lacks the app UI; permission/occlusion must be resolved before accepting it",
        );
      const filename = `native-glass-${variant.theme}-${variant.locale}-${name}.png`;
      await writeFile(
        join(output, filename),
        Buffer.from(captured.png, "base64"),
      );
      const screenFilename = filename.replace(
        "native-glass",
        "native-screen-glass",
      );
      await writeFile(
        join(output, screenFilename),
        composited.toBuffer("image/png"),
      );
      materials.push({
        ...variant,
        backdrop: name,
        screenshot: screenFilename,
        windowThumbnail: filename,
        state,
        size: { width: composited.width, height: composited.height },
        sourceId: captured.sourceId,
        sampledColors: screenColors.size,
        display: captured.display,
        kind: "app rectangle cropped from the actual macOS display compositor; window thumbnail retained separately",
      });
    }
  }
  await writeFile(
    join(output, "native-materials.json"),
    JSON.stringify(materials, null, 2),
  );
  await writeFile(
    join(output, "native-report.json"),
    JSON.stringify({ metadata, checks, errors, materials }, null, 2),
  );
  console.log("LINK CHECKS AND NATIVE COMPOSITOR CAPTURES COMPLETE");
} finally {
  await linkBrowser.close().catch(() => {});
  await application.close();
  server.closeAllConnections();
  await new Promise((closed) => server.close(closed));
}
if (checks.some((check) => !check.pass) || errors.length) process.exitCode = 1;
