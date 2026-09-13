import { ARTEMIS_MARKDOWN_ICON_PATH } from "@artemis/ui/icons";
import {
  filePresentation,
  type WorkspaceFilePresentation,
} from "./workspace-file-presentation.js";

export interface SetiFileIcon {
  color: string;
  svg: string;
}

// Repository-owned line icons. Keep the existing helper API for all file surfaces.
const glyphs = {
  document:
    '<rect x="4" y="2.5" width="12" height="15" rx="2"/><path d="M7 7h6M7 10h6M7 13h4"/>',
  markdown: `<path d="${ARTEMIS_MARKDOWN_ICON_PATH}" fill="var(--artemis-color-status-success, currentColor)" stroke="none" transform="scale(0.833333)"/>`,
  code: '<path d="m7 5-5 5 5 5m6-10 5 5-5 5m-2-12-2 14"/>',
  braces:
    '<path d="M7 3H6a2 2 0 0 0-2 2v2c0 2-2 3-2 3s2 1 2 3v2a2 2 0 0 0 2 2h1m6-14h1a2 2 0 0 1 2 2v2c0 2 2 3 2 3s-2 1-2 3v2a2 2 0 0 1-2 2h-1"/><circle cx="8" cy="10" r=".5"/><circle cx="12" cy="10" r=".5"/>',
  config:
    '<path d="M3 5h14M3 10h14M3 15h14"/><rect x="6" y="3" width="3" height="4" rx="1"/><rect x="12" y="8" width="3" height="4" rx="1"/><rect x="5" y="13" width="3" height="4" rx="1"/>',
  format: '<path d="M4 4h12M7 8h9M7 12h7M4 16h12M3 8v4"/>',
  git: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="16" r="2"/><circle cx="15" cy="6" r="2"/><path d="M6 6v8m9-6v2a6 6 0 0 1-6 6H8"/>',
  build: '<path d="m10 2 7 4v8l-7 4-7-4V6Zm-7 4 7 4 7-4m-7 4v8m-3.5-14 7 4"/>',
  license:
    '<path d="M10 2 17 5v5c0 4-4 7-7 8-3-1-7-4-7-8V5Z"/><path d="m6.5 10 2.5 2.5 4.5-5"/>',
  terminal:
    '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="m6 7 3 3-3 3m5 0h3"/>',
  image:
    '<rect x="2.5" y="3" width="15" height="14" rx="2"/><circle cx="7" cy="7.5" r="1.5"/><path d="m3 14 4-4 3 3 3-5 4 6"/>',
  audio:
    '<path d="M9 14V4l7-2v10M9 7l7-2"/><ellipse cx="6.5" cy="14.5" rx="2.5" ry="2"/><ellipse cx="13.5" cy="12.5" rx="2.5" ry="2"/>',
  video:
    '<rect x="2" y="4" width="11" height="12" rx="2"/><path d="m13 8 5-3v10l-5-3Z"/>',
  archive:
    '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 7h14M8 11h4M7 3V1m6 2V1"/>',
  data: '<ellipse cx="10" cy="4.5" rx="7" ry="2.5"/><path d="M3 4.5v11c0 3.3 14 3.3 14 0v-11M3 10c0 3.3 14 3.3 14 0"/>',
  hidden:
    '<path d="M12 3H5a1 1 0 0 0-1 1v11m3 2h8a1 1 0 0 0 1-1V7l-4-4v4h4M3 18 18 3"/>',
} as const;

const colors = {
  blue: ["#3978bc", "#77acee"],
  green: ["#258347", "#60c878"],
  cyan: ["#328399", "#7bbecc"],
  amber: ["#a66b22", "#e8b16c"],
  mint: ["#31846f", "#72c4ae"],
  purple: ["#7862b8", "#a59be5"],
  coral: ["#b96856", "#e69182"],
  neutral: ["#68717d", "#a1a9b4"],
} as const;

type IconKind = keyof typeof glyphs;
type IconColor = keyof typeof colors;
const types: Record<string, readonly [IconKind, IconColor]> = {
  typescript: ["code", "blue"],
  javascript: ["code", "amber"],
  react: ["code", "cyan"],
  c: ["code", "blue"],
  cpp: ["code", "purple"],
  csharp: ["code", "mint"],
  python: ["code", "amber"],
  html: ["code", "coral"],
  markup: ["code", "coral"],
  css: ["code", "purple"],
  json: ["braces", "amber"],
  yaml: ["config", "purple"],
  config: ["config", "neutral"],
  markdown: ["markdown", "green"],
  git: ["git", "coral"],
  prettier: ["format", "mint"],
  cmake: ["build", "mint"],
  license: ["license", "amber"],
  shell: ["terminal", "mint"],
  powershell: ["terminal", "blue"],
};

// Labels are fixed constants, never derived from untrusted filenames.
const languageMarks: Record<string, readonly [string, IconColor]> = {
  ts: ["TS", "blue"],
  tsx: ["TSX", "cyan"],
  js: ["JS", "amber"],
  jsx: ["JSX", "cyan"],
  mjs: ["JS", "amber"],
  cjs: ["JS", "amber"],
  mts: ["TS", "blue"],
  cts: ["TS", "blue"],
  c: ["C", "blue"],
  h: ["C", "blue"],
  cpp: ["C++", "purple"],
  cc: ["C++", "purple"],
  cxx: ["C++", "purple"],
  hpp: ["C++", "purple"],
  hh: ["C++", "purple"],
  hxx: ["C++", "purple"],
  cs: ["C#", "mint"],
  py: ["PY", "amber"],
  pyi: ["PY", "amber"],
  rs: ["RS", "coral"],
  go: ["GO", "cyan"],
  swift: ["SW", "coral"],
  java: ["JV", "coral"],
  kt: ["KT", "purple"],
  kts: ["KT", "purple"],
  rb: ["RB", "coral"],
  php: ["PHP", "purple"],
  vue: ["VUE", "mint"],
  svelte: ["SV", "coral"],
  css: ["CSS", "purple"],
  scss: ["SC", "purple"],
  sass: ["SC", "purple"],
  html: ["HT", "coral"],
  htm: ["HT", "coral"],
  sh: ["SH", "mint"],
  bash: ["SH", "mint"],
  zsh: ["SH", "mint"],
  ps1: ["PS", "blue"],
  sql: ["SQL", "mint"],
  lua: ["LUA", "blue"],
  dart: ["DT", "cyan"],
  r: ["R", "blue"],
};

export function setiFileIcon(
  path: string,
  presentation: WorkspaceFilePresentation,
): SetiFileIcon {
  const name =
    path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  let [kind, color]: [IconKind, IconColor] = [
    ...(types[presentation.type] ?? ["document", "neutral"]),
  ];
  if (presentation.type === "plain") {
    if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif|heic)$/.test(name))
      [kind, color] = ["image", "mint"];
    else if (/\.(mp3|wav|flac|aac|ogg|m4a)$/.test(name))
      [kind, color] = ["audio", "purple"];
    else if (/\.(mp4|mov|webm|mkv|avi)$/.test(name))
      [kind, color] = ["video", "coral"];
    else if (/\.(zip|tar|gz|7z|rar|dmg|exe|dll|so|a|lib)$/.test(name))
      [kind, color] = ["archive", "amber"];
    else if (/\.(csv|tsv|sql|db|sqlite|xlsx?)$/.test(name))
      [kind, color] = ["data", "mint"];
    else if (/\.(rs|go|swift|java|kt|rb|php|vue|svelte)$/.test(name))
      [kind, color] = ["code", "blue"];
    else if (name.startsWith(".")) [kind, color] = ["hidden", "neutral"];
  }
  const extension = name.split(".").at(-1) ?? "";
  const language = name.includes(".") ? languageMarks[extension] : undefined;
  if (language) color = language[1];
  const markWidth = language ? (language[0].length > 2 ? 34 : 24) : 20;
  const glyph = language
    ? `<text x="${markWidth / 2}" y="10.5" text-anchor="middle" dominant-baseline="central" fill="currentColor" stroke="none" font-family="system-ui, sans-serif" font-size="17" font-weight="600">${language[0]}</text>`
    : glyphs[kind];
  const [light, dark] = colors[color];
  return {
    color,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${markWidth} 20"${language ? ` data-language-mark="${markWidth > 24 ? "wide" : "regular"}"` : ""} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:light-dark(${light},${dark})" aria-hidden="true" focusable="false">${glyph}</svg>`,
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
