import { createRequire } from "node:module";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = resolve(desktop, "../..");
const source = join(root, "artifacts/dev/ui-redesign/design-source");
const output = resolve(
  process.argv[2] ??
    join(root, "artifacts/verification/ui-redesign/review-06/local/references"),
);
const require = createRequire(import.meta.url),
  { _electron } = require("playwright-core");
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(tmpdir(), "artemis-review06-designs-"));
const main = join(staging, "main.cjs");
await writeFile(
  main,
  `const {app,BrowserWindow}=require(${JSON.stringify(require.resolve("electron"))});app.setPath('userData',${JSON.stringify(join(staging, "profile"))});app.whenReady().then(()=>new BrowserWindow({width:1440,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true}}).loadURL('about:blank'));`,
);
// require("electron") resolves to a path string outside Electron, not its API module.
await writeFile(
  main,
  (await readFile(main, "utf8")).replace(
    `require(${JSON.stringify(require.resolve("electron"))})`,
    'require("electron")',
  ),
);
await copyFile(join(source, "support.js"), join(staging, "support.js"));
await copyFile(join(source, "artemis.css"), join(staging, "artemis.css"));
const assets = join(desktop, "dist-renderer/assets"),
  files = await readdir(assets);
const font = (prefix) =>
  `file://${join(
    assets,
    files.find(
      (file) =>
        file.startsWith(prefix) &&
        file.endsWith(".woff2") &&
        !file.includes("-Italic-"),
    ),
  )}`;
const fontCss = `<style>@font-face{font-family:Geist;src:url('${font("Geist-")}');font-weight:100 900}@font-face{font-family:'Geist Mono';src:url('${font("GeistMono-")}');font-weight:100 900}</style>`;
const names = (await readdir(source))
  .filter((file) => file.endsWith(".dc.html"))
  .map((file) => file.replace(".dc.html", ""));
const settingsTabs = {
  general: "通用",
  providers: "模型服务",
  agents: "智能体",
  im: "消息集成",
  perm: "执行权限",
  hooks: "Hooks",
  updates: "更新与诊断",
};
const targets = names.flatMap((name) =>
  name === "Settings"
    ? [name, ...Object.keys(settingsTabs).map((tab) => `${name}@${tab}`)]
    : [name],
);
let app;
try {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [main],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  const page = await app.firstWindow();
  for (const theme of ["dark", "light"])
    for (const target of targets) {
      const [sourceName, tab] = target.split("@");
      const name = target.replace("@", "-");
      let html = (await readFile(join(source, `${sourceName}.dc.html`), "utf8"))
        .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, "")
        .replace(/("theme":\{[^}]*"default":)"(dark|light)"/, `$1"${theme}"`)
        .replace(/("material":\{[^}]*"default":)"(glass|solid)"/, '$1"solid"')
        .replace("<helmet>", `<helmet>${fontCss}`);
      const path = join(staging, `${name}.dc.html`);
      await writeFile(path, html);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`file://${path}`);
      await page.waitForTimeout(700);
      if (tab) {
        await page
          .getByRole("button", { name: settingsTabs[tab], exact: true })
          .click();
        await page.waitForTimeout(100);
      }
      await page.evaluate(() => document.fonts.ready);
      // User-approved baseline: 1440px is the outside width, including poster
      // padding. Original .dc.html files are never modified.
      await page.evaluate(() => {
        const board = document.querySelector(".ar");
        if (!board) throw new Error("Design board did not render");
        board.style.boxSizing = "border-box";
        board.style.width = "1440px";
      });
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      await page.setViewportSize({
        width: 1440,
        height: Math.max(height, 900),
      });
      await page.screenshot({
        path: join(output, `${name}-${theme}.png`),
        fullPage: true,
        scale: "css",
      });
      const inventory = await page.evaluate(() => {
        const root = document.querySelector(".ar");
        if (!root) throw new Error("Design board did not render");
        return [
          ...root.querySelectorAll(
            ".btn, .ibtn, .pill, .kbd, .mi, .opt, .dc, .gl, .cmp, .pop, .cbx, .switch, .seg, .tile, .fi, input, textarea, .h1, .h2, .h3, .lbl, .meta",
          ),
        ]
          .filter((element) => element.checkVisibility())
          .map((element, index) => {
            const style = getComputedStyle(element);
            return {
              index,
              tag: element.tagName,
              classes: element.className,
              text: element.textContent.trim().slice(0, 140),
              rect: element.getBoundingClientRect().toJSON(),
              font: style.fontFamily,
              size: style.fontSize,
              weight: style.fontWeight,
              lineHeight: style.lineHeight,
              color: style.color,
              background: style.backgroundColor,
              gap: style.gap,
              padding: style.padding,
              border: style.borderTopWidth,
              radius: style.borderRadius,
              icons: [...element.querySelectorAll("svg")].map((icon) => ({
                rect: icon.getBoundingClientRect().toJSON(),
                path: icon.querySelector("path")?.getAttribute("d"),
                color: getComputedStyle(icon).color,
              })),
            };
          });
      });
      await writeFile(
        join(output, `${name}-${theme}.json`),
        JSON.stringify(inventory, null, 2),
      );
      const full = await page.evaluate(() => {
        const root = document.querySelector(".ar");
        const nodes = [root, ...root.querySelectorAll("*")].filter(
          (element) =>
            !element.closest("svg, style, script") &&
            element.checkVisibility() &&
            element.getBoundingClientRect().width > 0 &&
            element.getBoundingClientRect().height > 0,
        );
        const selector = (element) => {
          const path = [];
          for (
            let current = element;
            current && current !== root.parentElement;
            current = current.parentElement
          ) {
            const siblings = [
              ...(current.parentElement?.children ?? []),
            ].filter((sibling) => sibling.tagName === current.tagName);
            path.unshift(
              `${current.tagName.toLowerCase()}${[...current.classList].map((name) => `.${CSS.escape(name)}`).join("")}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`,
            );
          }
          return path.join(" > ");
        };
        return {
          baseline:
            "1440px outer frame; full-page boards define containers; standalone boards define inner component metrics",
          viewport: { width: innerWidth, height: innerHeight },
          root: root.getBoundingClientRect().toJSON(),
          nodes: nodes.map((element, index) => {
            const style = getComputedStyle(element),
              contexts = [];
            for (
              let parent = element.parentElement;
              parent && parent !== root;
              parent = parent.parentElement
            ) {
              const label = parent.querySelector(
                ":scope > .cap, :scope > h3, :scope > .h3",
              );
              if (label && !label.contains(element))
                contexts.push(label.textContent.trim());
            }
            const textRects = [];
            for (const child of element.childNodes)
              if (
                child.nodeType === Node.TEXT_NODE &&
                child.textContent.trim()
              ) {
                const range = document.createRange();
                range.selectNode(child);
                textRects.push(
                  ...[...range.getClientRects()].map((rect) => rect.toJSON()),
                );
              }
            return {
              index,
              parent: nodes.indexOf(element.parentElement),
              selector: selector(element),
              tag: element.tagName.toLowerCase(),
              classes: element.className,
              context: contexts[0] ?? "",
              text: element.textContent.trim().slice(0, 160),
              directText: [...element.childNodes]
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent)
                .join("")
                .trim(),
              aria: element.getAttribute("aria-label"),
              placeholder: element.getAttribute("placeholder"),
              inputValue:
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement
                  ? element.value
                  : undefined,
              placeholderStyle: element.hasAttribute("placeholder")
                ? (() => {
                    const s = getComputedStyle(element, "::placeholder");
                    return {
                      font: s.fontFamily,
                      size: s.fontSize,
                      weight: s.fontWeight,
                      lineHeight: s.lineHeight,
                      color: s.color,
                      opacity: s.opacity,
                    };
                  })()
                : undefined,
              rect: element.getBoundingClientRect().toJSON(),
              textRects,
              font: style.fontFamily,
              size: style.fontSize,
              weight: style.fontWeight,
              lineHeight: style.lineHeight,
              color: style.color,
              background: style.backgroundColor,
              gap: style.gap,
              padding: style.padding,
              margin: style.margin,
              border: style.borderTopWidth,
              borderColor: style.borderTopColor,
              radius: style.borderRadius,
              opacity: style.opacity,
              letterSpacing: style.letterSpacing,
              icons: [...element.querySelectorAll(":scope > svg")].map(
                (icon) => ({
                  rect: icon.getBoundingClientRect().toJSON(),
                  paths: [...icon.querySelectorAll("path")].map((path) =>
                    path.getAttribute("d"),
                  ),
                  color: getComputedStyle(icon).color,
                  viewBox: icon.getAttribute("viewBox"),
                  strokeWidth: getComputedStyle(icon).strokeWidth,
                  shapes: [
                    ...icon.querySelectorAll(
                      "path, circle, rect, line, polyline, polygon, ellipse",
                    ),
                  ].map((shape) => ({
                    tag: shape.tagName,
                    attributes: Object.fromEntries(
                      [...shape.attributes]
                        .filter((attribute) => attribute.name !== "class")
                        .map((attribute) => [attribute.name, attribute.value]),
                    ),
                    fill: getComputedStyle(shape).fill,
                    stroke: getComputedStyle(shape).stroke,
                    strokeWidth: getComputedStyle(shape).strokeWidth,
                  })),
                }),
              ),
            };
          }),
        };
      });
      await writeFile(
        join(output, `${name}-${theme}.full.json`),
        JSON.stringify(full, null, 2),
      );
      console.log(`${name}-${theme}: ${inventory.length} components`);
    }
} finally {
  if (app) await app.close();
  await rm(staging, { recursive: true, force: true });
}
