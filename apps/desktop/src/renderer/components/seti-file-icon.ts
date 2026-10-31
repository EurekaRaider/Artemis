import {
  filePresentation,
  type WorkspaceFilePresentation,
} from "../workspace/workspace-file-presentation.js";

export interface SetiFileIcon {
  color: string;
  svg: string;
}

// Fixed labels and paths only: filenames never become SVG markup.
const glyphs = {
  file: '<path d="M5 2.5h4L12 6v7.5H4V2.5zM9 2.5V6h3"/>',
  fileText: '<path d="M5 2.5h4L12 6v7.5H4V2.5zM9 2.5V6h3M6 9h4M6 11h3"/>',
  key: '<circle cx="5.5" cy="10.5" r="2.5"/><path d="m7.5 8.5 5-5m-2 2 2 2m-4 0 1.5 1.5"/>',
  branch:
    '<circle cx="4.5" cy="4" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5.5v5m7-4v1a4.5 4.5 0 0 1-4.5 4.5H6"/>',
  image:
    '<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="m3 11 3-3 3 3 2-2 2 2"/><circle cx="10" cy="6" r="1"/>',
  sheet:
    '<rect x="3" y="3" width="10" height="10" rx="1.5"/><path d="M3 6.5h10M3 10h10M7 3v10"/>',
  slides: '<path d="M2.5 3h11M4 3v7h8V3M8 10v3M6 13h4"/>',
  format: '<path d="M3 4h10M6 8h7M3 12h10M3 7v2"/>',
  build: '<path d="m8 2 5 3v6l-5 3-5-3V5zM3 5l5 3 5-3M8 8v6"/>',
  license: '<path d="m8 2 5 2v4c0 3-3 5-5 6-2-1-5-3-5-6V4zM5.5 8l2 2 3-4"/>',
} as const;
type Tile = { label?: string; hue?: number; glyph?: keyof typeof glyphs };
const tiles: Record<string, Tile> = {
  ts: { label: "TS", hue: 250 },
  tsx: { label: "TS", hue: 250 },
  js: { label: "JS", hue: 95 },
  jsx: { label: "JS", hue: 95 },
  mjs: { label: "JS", hue: 95 },
  cjs: { label: "JS", hue: 95 },
  json: { label: "{}", hue: 80 },
  md: { label: "MD" },
  mdx: { label: "MD" },
  css: { label: "#", hue: 300 },
  scss: { label: "#", hue: 300 },
  sass: { label: "#", hue: 300 },
  html: { label: "&lt;&gt;", hue: 40 },
  htm: { label: "&lt;&gt;", hue: 40 },
  py: { label: "PY", hue: 225 },
  pyi: { label: "PY", hue: 225 },
  sh: { label: "$_", hue: 150 },
  bash: { label: "$_", hue: 150 },
  zsh: { label: "$_", hue: 150 },
  ps1: { label: "$_", hue: 150 },
  yml: { label: "YML", hue: 15 },
  yaml: { label: "YML", hue: 15 },
  sql: { label: "SQL", hue: 275 },
  pdf: { glyph: "fileText", hue: 25 },
  csv: { glyph: "sheet", hue: 150 },
  tsv: { glyph: "sheet", hue: 150 },
  xls: { glyph: "sheet", hue: 150 },
  xlsx: { glyph: "sheet", hue: 150 },
  ppt: { glyph: "slides", hue: 55 },
  pptx: { glyph: "slides", hue: 55 },
  doc: { glyph: "fileText", hue: 255 },
  docx: { glyph: "fileText", hue: 255 },
  cpp: { label: "C++", hue: 250 },
  c: { label: "C", hue: 250 },
  cs: { label: "C#", hue: 275 },
  rs: { label: "RS", hue: 40 },
  go: { label: "GO", hue: 225 },
};

// Preserve the public helper name used by file trees, editors and Markdown links.
export function setiFileIcon(
  path: string,
  presentation: WorkspaceFilePresentation,
): SetiFileIcon {
  const name =
    path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  const extension = name.split(".").at(-1) ?? "";
  let tile: Tile = (name.includes(".") ? tiles[extension] : undefined) ?? {
    glyph: "file",
  };
  if (name === ".env" || name.startsWith(".env.")) tile = { glyph: "key" };
  else if (presentation.type === "git") tile = { glyph: "branch" };
  else if (presentation.type === "prettier") tile = { glyph: "format" };
  else if (presentation.type === "cmake") tile = { glyph: "build" };
  else if (presentation.type === "license") tile = { glyph: "license" };
  else if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|heic)$/.test(name))
    tile = { glyph: "image", hue: 195 };
  const hue = tile.hue;
  const foreground =
    hue === undefined
      ? "var(--artemis-color-text-secondary)"
      : `light-dark(oklch(.47 .15 ${hue}),oklch(.86 .12 ${hue}))`;
  const background =
    hue === undefined
      ? "var(--artemis-color-surface-sunken)"
      : `light-dark(oklch(.93 .045 ${hue}),oklch(.33 .06 ${hue}))`;
  const content = tile.label
    ? `<text x="8" y="8.5" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none" font-family="Geist Mono,ui-monospace,monospace" font-size="${tile.label.length > 2 && tile.label !== "&lt;&gt;" ? 6 : 7.5}" font-weight="600">${tile.label}</text>`
    : glyphs[tile.glyph ?? "file"];
  return {
    color: hue === undefined ? "neutral" : String(hue),
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" style="color:${foreground}" aria-hidden="true" focusable="false"><rect width="16" height="16" rx="4" fill="${background}" stroke="none"/>${content}</svg>`,
  };
}

export function workspaceFileIconPath(href: string): string {
  const value = href.trim();
  if (/^file:/iu.test(value)) {
    try {
      return decodeURI(new URL(value).pathname);
    } catch {
      return value;
    }
  }

  const path = value
    .replace(/#L[1-9]\d*(?:C[1-9]\d*)?$/iu, "")
    .replace(/:[1-9]\d*(?::[1-9]\d*)?$/u, "");
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function workspaceFileLinkIcon(href: string): SetiFileIcon {
  const path = workspaceFileIconPath(href);
  return setiFileIcon(path, filePresentation(path));
}
