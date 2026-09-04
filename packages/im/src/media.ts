// 出站媒体提取（证据：ggcode internal/im/image_extract.go 的
// ExtractImagesFromText 移植 + 扩展）
//
// 纯函数、零 I/O：只做正则提取与文本清洗。真正的 URL 下载 / 本地路径读取
// 交给 SDK 的 toBuffer（已含 SSRF 防护 + 大小限制）。本模块不 import 任何
// Node 或 Electron 依赖，可被单测在 node 环境直跑。
//
// 相比 ggcode 的差异：
// - 新增视频提取：本地 .mp4 路径（markdown 或裸路径形式）
// - 返回的 source 语义与 SDK LarkChannel SendInput 的 media source 对齐
//   （http(s) URL / 本地路径 / data:image base64）

import { Buffer } from "node:buffer";

export type ExtractedMediaKind = "image" | "video";

export interface ExtractedMedia {
  kind: ExtractedMediaKind;
  /** 交给 SDK toBuffer 的 source：http(s) URL、本地路径、或 data:image base64 */
  source: string;
}

const IMAGE_EXT = "png|jpe?g|gif|webp";

const markdownImageRe = /!\[([^\]]*)\]\(([^)]+)\)/gi;
const bareImageUrlRe = new RegExp(
  `(?:^|[\\s(])(https?://[^\\s)"'<>?#]+\\.(?:${IMAGE_EXT})(?:\\?[^\\s"'<>]*)?)`,
  "gi",
);
const dataImageUrlRe = new RegExp(
  `(data:image/(?:${IMAGE_EXT});base64,[A-Za-z0-9+/=]+)`,
  "gi",
);
const bareVideoPathRe =
  /(?:^|[\s(])((?:\.{0,2}\/)?[^\s"'()<>]+\.mp4)(?:\?[^\s"'<>]*)?(?:\))?/gi;

const IMAGE_LIKE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** 判定一个字符串看起来是本地图片/视频路径（对齐 ggcode IsLocalFilePath，扩展 mp4） */
export function isLocalMediaPath(s: string): boolean {
  const t = s.trim();
  if (t === "") return false;
  if (t.startsWith("/")) return true;
  if (t.startsWith("./") || t.startsWith("../")) return true;
  if (t.includes("://")) return false;
  const dot = t.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = t.slice(dot + 1).toLowerCase();
  return IMAGE_LIKE_EXT.has(ext) || ext === "mp4";
}

/**
 * 从要发出的文本中提取媒体引用并清洗文本：
 * - markdown 图片 `![alt](url)` → 保留 alt 文本，URL 入 media
 * - 裸图片 URL（png/jpg/jpeg/gif/webp）→ 移除，URL 入 media
 * - data:image base64 → 移除，dataURL 入 media
 * - markdown/裸 .mp4 本地路径 → 移除，路径入 media
 * 返回清洗后的文本 + 去重后的媒体列表（顺序稳定）。
 */
export function extractMediaFromText(text: string): {
  media: ExtractedMedia[];
  text: string;
} {
  const media: ExtractedMedia[] = [];
  const seen = new Set<string>();
  const add = (kind: ExtractedMediaKind, source: string) => {
    const key = `${kind}:${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    media.push({ kind, source });
  };

  let out = text;

  // 1. markdown 媒体（图片/视频）单遍处理：.mp4 → 视频（整段剥离）；
  //    其他 → 图片（保留 alt 文本）
  out = out.replace(markdownImageRe, (_all, alt: string, url: string) => {
    const u = url?.trim();
    if (!u) return "";
    if (/\.mp4$/i.test(u)) {
      add("video", u);
      return alt ?? "";
    }
    add("image", u);
    return alt ?? "";
  });

  // 2. 裸图片 URL：移除，URL 入 media
  for (const m of out.matchAll(bareImageUrlRe)) {
    const url = m[1]?.trim();
    if (url) add("image", url);
  }
  out = out.replace(bareImageUrlRe, "");

  // 3. data:image base64：移除，dataURL 入 media
  for (const m of out.matchAll(dataImageUrlRe)) {
    const dataUrl = m[1]?.trim();
    if (dataUrl) add("image", dataUrl);
  }
  out = out.replace(dataImageUrlRe, "");

  // 4. 裸 .mp4 本地路径：移除，路径入 media
  for (const m of out.matchAll(bareVideoPathRe)) {
    const path = m[1]?.trim();
    if (path) add("video", path);
  }
  out = out.replace(bareVideoPathRe, "");

  out = out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return { media, text: out };
}

/** data:image base64 URL → Buffer（SDK toBuffer 不认 data URL，需本模块解码） */
export function decodeDataImageUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  const data = m?.[2];
  if (!data) return null;
  try {
    return Buffer.from(data, "base64");
  } catch {
    return null;
  }
}