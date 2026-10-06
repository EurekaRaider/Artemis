// PR#245 P1-3：设计面板「代码」视图的项目文件读取管线（从 main.ts 抽出
// 以便可测试）。安全模型：
//   - 请求路径过白名单扩展与字符串层工作区包含检查（快速预过滤）；
//   - 真实根（realpath）才是权威边界：readWorkspaceFileBytes 对每一次
//     实际读取（主文件 + CSS @import 链 + <link> + <img> + 本地 <script>）
//     做 realpath 包含校验 + O_NOFOLLOW 打开 + fstat 上限 + 有界读取 +
//     读后 realpath 复核——工作区内的符号链接指向区外即拒绝；
//   - 内联限深 3、单文件上限（css 512KiB / 图 2MiB / js 1MiB）、总预算
//     6MiB、visited 防环。

import { constants as fsConstants } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

/** 项目图片资产（dataURL 内联）的 MIME 表。 */
export const DESIGN_IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

interface DesignInlineBudget {
  spent: number;
  cache: Map<string, string>;
}

const DESIGN_PROJECT_TEXT_EXTENSIONS =
  /\.(html?|css|m?js|json|md|svg|txt|tsx?|jsx|vue)$/i;

/**
 * 工作区内文件的安全读取。字符串路径解析只挡得住字面穿越，stat/
 * readFile 会跟随符号链接：这里先 realpath 校验真实路径确实落在工作区
 * 内（拦截链中任何一级指向区外的 symlink），再以 O_NOFOLLOW 打开（拒绝
 * 校验与打开之间最终组件被换成链接），fstat 限定常规文件与大小上限，
 * 按 stat 大小有界读取（校验后追加写直接拒绝），读毕复查 realpath 未
 * 被改指。任一步失败返回 undefined，由调用方按「不可用/跳过引用」处理
 * ——预览路径宁可缺资源也不越界。
 */
export async function readWorkspaceFileBytes(
  workspaceRootReal: string,
  candidate: string,
  maxBytes: number,
): Promise<{ bytes: Buffer; size: number } | undefined> {
  const real = await realpath(candidate).catch(() => undefined);
  if (!real) return undefined;
  if (real !== workspaceRootReal && !real.startsWith(workspaceRootReal + sep))
    return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      real,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    ).catch(() => undefined);
    if (!handle) return undefined;
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > maxBytes) return undefined;
    const bytes = Buffer.alloc(metadata.size + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await handle.read(
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        bytesRead,
      );
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > metadata.size) return undefined;
    if ((await realpath(candidate).catch(() => undefined)) !== real)
      return undefined;
    return { bytes: bytes.subarray(0, bytesRead), size: metadata.size };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** 相对引用 → 工作区内绝对路径；协议/绝对/越界一律拒绝（字符串预过滤）。 */
export function resolveProjectRef(
  workspaceRoot: string,
  fromDir: string,
  href: string,
): string | undefined {
  const clean = href.replace(/[?#].*$/, "").trim();
  if (!clean || /^[a-z]+:/iu.test(clean) || clean.startsWith("/"))
    return undefined;
  const absolute = resolve(fromDir, clean);
  if (absolute !== workspaceRoot && !absolute.startsWith(workspaceRoot + sep))
    return undefined;
  return absolute;
}

/** 本地图片资产读成 dataURL（预算内）；失败返回 undefined 原样保留引用。
 * workspaceRoot 为字符串根（快速预过滤），workspaceRootReal 为真实根
 * （readWorkspaceFileBytes 的权威校验）。 */
async function projectAssetDataUrl(
  workspaceRoot: string,
  workspaceRootReal: string,
  fromDir: string,
  href: string,
  budget: DesignInlineBudget,
): Promise<string | undefined> {
  const absolute = resolveProjectRef(workspaceRoot, fromDir, href);
  if (!absolute) return undefined;
  const cached = budget.cache.get(absolute);
  if (cached !== undefined) return cached || undefined;
  const mime = DESIGN_IMAGE_MIME[extname(absolute).toLowerCase()];
  if (!mime) return undefined;
  const read = await readWorkspaceFileBytes(
    workspaceRootReal,
    absolute,
    2 * 1024 * 1024,
  );
  if (!read || budget.spent + read.size > 6 * 1024 * 1024) return undefined;
  budget.cache.set(absolute, "");
  budget.spent += read.size;
  const dataUrl = `data:${mime};base64,${read.bytes.toString("base64")}`;
  budget.cache.set(absolute, dataUrl);
  return dataUrl;
}

/** CSS 文本：@import 链递归展开 + 本地图片 url() 转 dataURL。 */
async function inlineProjectCss(
  css: string,
  cssDir: string,
  workspaceRoot: string,
  workspaceRootReal: string,
  budget: DesignInlineBudget,
  depth: number,
): Promise<string> {
  let output = css;
  const importPattern =
    /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*;/giu;
  for (const match of [...output.matchAll(importPattern)]) {
    const absolute = resolveProjectRef(workspaceRoot, cssDir, match[1] ?? "");
    if (!absolute) {
      output = output.replace(match[0], "");
      continue;
    }
    const cached = budget.cache.get(absolute);
    if (cached !== undefined) {
      output = output.replace(match[0], cached);
      continue;
    }
    const read = await readWorkspaceFileBytes(
      workspaceRootReal,
      absolute,
      512 * 1024,
    );
    if (!read) {
      output = output.replace(match[0], "");
      continue;
    }
    let nested = read.bytes.toString("utf8");
    if (depth + 1 <= 3)
      nested = await inlineProjectCss(
        nested,
        dirname(absolute),
        workspaceRoot,
        workspaceRootReal,
        budget,
        depth + 1,
      );
    budget.spent += read.size;
    const replacement = `/* ${basename(absolute)} */\n${nested}`;
    budget.cache.set(absolute, replacement);
    output = output.replace(match[0], replacement);
  }
  const urlPattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/giu;
  for (const match of [...output.matchAll(urlPattern)]) {
    const ref = match[2];
    if (!ref) continue;
    const dataUrl = await projectAssetDataUrl(
      workspaceRoot,
      workspaceRootReal,
      cssDir,
      ref,
      budget,
    );
    if (!dataUrl) continue;
    output = output.replace(match[0], `url(${match[1]}${dataUrl}${match[1]})`);
  }
  return output;
}

/**
 * 项目 HTML 的资源内联：本地 <link rel=stylesheet> 递归成 <style>（含
 * @import 链与 CSS url()）、<img src> 本地图片转 dataURL——预览净化管线
 * 会剥外部引用，不内联则样式/图片全丢。
 */
async function inlineProjectHtmlAssets(
  workspaceRoot: string,
  workspaceRootReal: string,
  htmlDir: string,
  html: string,
  budget: DesignInlineBudget,
  depth: number,
): Promise<string> {
  if (depth > 3) return html;
  let output = html;
  const linkPattern = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/giu;
  for (const match of [...output.matchAll(linkPattern)]) {
    const href = /href=["']([^"']+)["']/iu.exec(match[0])?.[1];
    if (!href) continue;
    const absolute = resolveProjectRef(workspaceRoot, htmlDir, href);
    if (!absolute) continue;
    const read = await readWorkspaceFileBytes(
      workspaceRootReal,
      absolute,
      512 * 1024,
    );
    if (!read) continue;
    let css = read.bytes.toString("utf8");
    if (depth + 1 <= 3)
      css = await inlineProjectCss(
        css,
        dirname(absolute),
        workspaceRoot,
        workspaceRootReal,
        budget,
        depth + 1,
      );
    output = output.replace(match[0], `<style>\n${css}\n</style>`);
  }
  const imgPattern = /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/giu;
  for (const match of [...output.matchAll(imgPattern)]) {
    const src = match[2];
    if (!src) continue;
    const dataUrl = await projectAssetDataUrl(
      workspaceRoot,
      workspaceRootReal,
      htmlDir,
      src,
      budget,
    );
    if (!dataUrl) continue;
    output = output.replace(match[0], `${match[1]}${dataUrl}${match[3]}`);
  }
  // 本地 <script src> 内联成行内脚本（预览走 srcdoc 沙箱 iframe，无 base
  // URL 相对引用会失效；远程 CDN 脚本保留引用由网络加载）。module 语义
  // 经 type 属性保留。
  const scriptPattern =
    /<script\b([^>]*\bsrc=["'])([^"']+)(["'][^>]*)><\/script>/giu;
  for (const match of [...output.matchAll(scriptPattern)]) {
    const ref = match[2];
    if (!ref || /^[a-z]+:/iu.test(ref) || ref.startsWith("//")) continue;
    const absolute = resolveProjectRef(workspaceRoot, htmlDir, ref);
    if (!absolute) continue;
    const read = await readWorkspaceFileBytes(
      workspaceRootReal,
      absolute,
      1024 * 1024,
    );
    if (!read) continue;
    const code = read.bytes.toString("utf8");
    const attrs = (match[1] ?? "").replace(/\bsrc=["'][^"']*["']/giu, "");
    output = output.replace(
      match[0],
      `<script${attrs}>${code.replace(/<\/script>/giu, "<\\/script>")}<\/script>`,
    );
  }
  return output;
}

export class ProjectFileReadError extends Error {}

/**
 * 面板「代码」视图的项目文件读取入口（readProjectFile 处理器的主体）。
 * 路径封死在工作区内、限文本扩展、主文件 ≤2MiB；HTML 在预算内联依赖。
 */
export async function readProjectFileForPreview(input: {
  workspacePath: string;
  requestedPath: string;
}): Promise<{ name: string; content: string }> {
  const requestedPath = String(input.requestedPath ?? "").trim();
  if (
    !requestedPath ||
    requestedPath.includes("..") ||
    requestedPath.startsWith("/")
  )
    throw new ProjectFileReadError("Invalid project file path.");
  if (DESIGN_SCAN_IMAGE_EXTENSIONS.has(extname(requestedPath).toLowerCase())) {
    const dataUrl = await readDesignImage(input.workspacePath, requestedPath);
    if (!dataUrl)
      throw new ProjectFileReadError("Project image is unreadable or unsafe.");
    return {
      name: requestedPath,
      content: `<html><body style="margin:0;display:grid;place-items:center;height:100vh"><img style="max-width:100%;max-height:100vh" src="${dataUrl}"></body></html>`,
    };
  }
  if (!DESIGN_PROJECT_TEXT_EXTENSIONS.test(requestedPath))
    throw new ProjectFileReadError("此项目文件类型暂不支持预览。");
  const absolute = join(input.workspacePath, requestedPath);
  const workspaceRoot = resolve(input.workspacePath);
  if (
    resolve(absolute) !== workspaceRoot &&
    !resolve(absolute).startsWith(workspaceRoot + sep)
  )
    throw new ProjectFileReadError("Project file path escapes the workspace.");
  // P1-3：字符串校验挡不住符号链接（stat/readFile 会跟随链接读到工作
  // 区外）。真实根 + readWorkspaceFileBytes 的 realpath/O_NOFOLLOW 有界
  // 读取是权威校验；realpath 失败（含指向区外的链接）直接拒绝。
  const workspaceRootReal = (await realpath(workspaceRoot).catch(
    () => undefined,
  )) as string | undefined;
  if (!workspaceRootReal)
    throw new ProjectFileReadError("Project workspace is not readable.");
  const read = await readWorkspaceFileBytes(
    workspaceRootReal,
    absolute,
    2 * 1024 * 1024,
  );
  if (!read)
    throw new ProjectFileReadError("Project file is unreadable or unsafe.");
  const content = read.bytes.toString("utf8");
  const inlined = /\.html?$/i.test(requestedPath)
    ? await inlineProjectHtmlAssets(
        workspaceRoot,
        workspaceRootReal,
        dirname(absolute),
        content,
        { spent: 0, cache: new Map() },
        0,
      )
    : content;
  return { name: requestedPath, content: inlined };
}

/** 项目文件扫描（面板「设计文件」总览）：保守白名单——只收 设计页面
 * （html/htm）与图片（png/jpg/jpeg/gif/webp/avif），与面板胶囊的两类
 * 一致。广度优先浅层优先，深度 ≤4、总量 ≤120；跳过点开头/符号链接/
 * 依赖与构建产物目录；拒绝符号链接（与读取管线的安全模型一致）。 */
export const DESIGN_SCAN_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
]);

const DESIGN_SCAN_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  "dist-renderer",
  "build",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
  ".cache",
  ".next",
  ".output",
  "target",
  "artifacts",
  ".zcode",
]);

export async function scanProjectDesignFiles(
  workspacePath: string,
  imagesOnly = false,
): Promise<Array<{ path: string; bytes: number; updatedAt: string }>> {
  const files: Array<{ path: string; bytes: number; updatedAt: string }> = [];
  let level: Array<{ dir: string; prefix: string }> = [
    { dir: workspacePath, prefix: "" },
  ];
  for (let depth = 0; level.length > 0 && files.length < 120; depth += 1) {
    if (depth > 4) break;
    const next: Array<{ dir: string; prefix: string }> = [];
    for (const { dir, prefix } of level) {
      if (files.length >= 120) break;
      const entries = (
        await readdir(dir, { withFileTypes: true }).catch(() => [])
      ).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= 120) break;
        if (entry.name.startsWith(".")) continue;
        const absolute = join(dir, entry.name);
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (DESIGN_SCAN_IGNORED_DIRS.has(entry.name)) continue;
          next.push({ dir: absolute, prefix: path });
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = extname(entry.name).toLowerCase();
        if (
          (imagesOnly || (ext !== ".html" && ext !== ".htm")) &&
          !DESIGN_SCAN_IMAGE_EXTENSIONS.has(ext)
        )
          continue;
        const info = await stat(absolute).catch(() => undefined);
        if (!info || !info.isFile()) continue;
        files.push({
          path,
          bytes: info.size,
          updatedAt: info.mtime.toISOString(),
        });
      }
    }
    level = next;
  }
  return files;
}

/** Read a selected image directory through the same bounded, rechecked pipeline as previews. */
export async function readDesignImage(
  directory: string,
  requestPath: string,
): Promise<string | undefined> {
  const relative = requestPath.replace(/^image-(?:dir|view):/, "");
  if (!DESIGN_SCAN_IMAGE_EXTENSIONS.has(extname(relative).toLowerCase()))
    return undefined;
  const root = await realpath(directory).catch(() => undefined);
  if (!root) return undefined;
  const target = resolve(root, relative);
  const read = await readWorkspaceFileBytes(root, target, 2 * 1024 * 1024);
  if (!read) return undefined;
  return `data:${DESIGN_IMAGE_MIME[extname(relative).toLowerCase()]};base64,${read.bytes.toString("base64")}`;
}
