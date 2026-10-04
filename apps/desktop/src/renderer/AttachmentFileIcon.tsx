import { useId } from "react";

// Labels and glyphs are fixed artwork; filenames are only used for classification.
const families = {
  code: { color: "#437db6", glyph: "code" },
  script: { color: "#546b76", glyph: "terminal" },
  markdown: { color: "#404953", glyph: "markdown" },
  log: { color: "#6d7884", glyph: "lines" },
  text: { color: "#7b8490", glyph: "lines" },
  config: { color: "#947346", glyph: "braces" },
  yaml: { color: "#8b668d", glyph: "sliders" },
  git: { color: "#bc684f", glyph: "branch" },
  build: { color: "#498aaa", glyph: "boxes" },
  data: { color: "#6882ad", glyph: "database" },
  pdf: { color: "#d96252", glyph: "pdf" },
  document: { color: "#5086b9", glyph: "lines" },
  sheet: { color: "#4f956d", glyph: "grid" },
  slides: { color: "#c78050", glyph: "chart" },
  archive: { color: "#81858a", glyph: "zip" },
  image: { color: "#589582", glyph: "image" },
  audio: { color: "#9374b1", glyph: "audio" },
  video: { color: "#ab7083", glyph: "play" },
  font: { color: "#7c739d", glyph: "font" },
  binary: { color: "#768596", glyph: "boxes" },
  file: { color: "#86909b", glyph: "lines" },
} as const;
type Family = keyof typeof families;
type FileMark = readonly [Family, string, (string | undefined)?];

const extensions: Record<string, FileMark> = Object.create(null);
function register(
  names: string,
  family: Family,
  label: string,
  color?: string,
) {
  for (const name of names.split(" "))
    extensions[name] = [family, label, color];
}
register("ts mts cts", "code", "TS");
register("tsx", "code", "TSX");
register("js mjs cjs", "code", "JS", "#d5ad42");
register("jsx", "code", "JSX", "#d5ad42");
register("py pyw pyi ipynb", "code", "PY", "#538ca1");
register("go", "code", "GO", "#439ba7");
register("rs", "code", "RS", "#ad725a");
register("java class jar", "code", "JAVA", "#b67b4f");
register("c h", "code", "C");
register("cpp cc cxx hpp hh hxx", "code", "C++", "#7f78b1");
register("cs", "code", "C#", "#628d78");
register("swift", "code", "SW", "#bf7855");
register("kt kts", "code", "KT", "#8c73b0");
register("rb erb", "code", "RB", "#b56565");
register("php", "code", "PHP", "#7d7aa6");
register("lua", "code", "LUA");
register("dart", "code", "DART", "#439ba7");
register("r rmd", "code", "R");
register("ex exs", "code", "EX", "#8c73b0");
register("scala sc", "code", "SC", "#b56565");
register("pl pm", "code", "PL");
register("vue", "code", "VUE", "#548e78");
register("svelte", "code", "SV", "#bf7855");
register("html htm xhtml", "code", "HTML", "#be775b");
register("css scss sass less", "code", "CSS", "#8b78b4");
register("xml xsl xsd", "code", "XML", "#b18b4e");
register("svg", "image", "SVG");
register("md markdown mdx mdown mkd", "markdown", "MD");
register("log out err", "log", "LOG");
register("txt text rst rtf", "text", "TXT");
register("json jsonc json5 jsonl ndjson", "config", "JSON");
register("yaml yml", "yaml", "YAML");
register("toml", "config", "TOML");
register("ini cfg conf config properties env editorconfig", "config", "CFG");
register("sh bash zsh fish ksh csh", "script", "SH");
register("ps1 psm1 psd1", "script", "PS");
register("bat cmd", "script", "CMD");
register("sql", "data", "SQL");
register("db sqlite sqlite3 mdb", "data", "DB");
register("csv tsv", "sheet", "CSV");
register("pdf", "pdf", "PDF");
register("doc odt pages", "document", "DOC");
register("docx", "document", "DOCX");
register("xls xlsm ods numbers", "sheet", "XLS");
register("xlsx", "sheet", "XLSX");
register("ppt odp key", "slides", "PPT");
register("pptx", "slides", "PPTX");
register("zip tar gz tgz bz2 xz 7z rar zst cab", "archive", "ZIP");
register(
  "png jpg jpeg gif webp avif heic heif bmp tif tiff ico psd ai sketch",
  "image",
  "IMG",
);
register("mp3 wav flac aac ogg opus m4a aiff mid midi", "audio", "AUD");
register("mp4 mov webm mkv avi m4v mpg mpeg", "video", "VID");
register("ttf otf woff woff2 eot", "font", "Aa");
register("exe dll so dylib bin wasm dmg iso app deb rpm apk", "binary", "BIN");

export function attachmentFileType(path: string) {
  const name =
    path.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
  let mark: FileMark | undefined;
  if (/^(dockerfile|containerfile)(\.|$)/.test(name)) mark = ["build", "DOCK"];
  else if (/^(makefile|gnumakefile|cmakelists\.txt)$/.test(name))
    mark = ["build", "MAKE"];
  else if (/^\.git(ignore|attributes|modules|config)$/.test(name))
    mark = ["git", "GIT"];
  else if (/^\.env($|\.)/.test(name)) mark = ["config", "ENV"];
  else if (/^\.(bashrc|zshrc|profile|bash_profile)$/.test(name))
    mark = ["script", "SH"];
  else if (/^(license|licence|readme|changelog)(\.txt)?$/.test(name))
    mark = ["text", "TXT"];
  else if (/^\.(npmrc|yarnrc|prettierrc|eslintrc)/.test(name))
    mark = ["config", "CFG"];
  const [family, label, color] = mark ??
    (name.includes(".")
      ? extensions[name.split(".").at(-1) ?? ""]
      : undefined) ?? ["file", "FILE"];
  return { family, label, ...families[family], ...(color ? { color } : {}) };
}

const glyphs = {
  python: (
    <g stroke="none">
      <path
        fill="#377ba7"
        d="M15.8 6c-5 0-4.7 2.2-4.7 2.2v3h5v1H9.2s-3.2-.3-3.2 4.4c0 4.7 2.8 4.5 2.8 4.5h1.7v-2.4s-.1-2.8 2.7-2.8h4.7s2.6 0 2.6-2.6V8.5S21 6 15.8 6Z"
      />
      <path
        fill="#efc44e"
        d="M16.2 27c5 0 4.7-2.2 4.7-2.2v-3h-5v-1h6.9s3.2.3 3.2-4.4c0-4.7-2.8-4.5-2.8-4.5h-1.7v2.4s.1 2.8-2.7 2.8h-4.7s-2.6 0-2.6 2.6v4.8s-.5 2.5 4.7 2.5Z"
      />
      <circle cx="14" cy="8.5" r="1" fill="white" />
      <circle cx="18" cy="24.5" r="1" fill="white" />
    </g>
  ),
  rust: (
    <g>
      <circle cx="16" cy="17" r="8.2" strokeWidth="2.6" />
      {Array.from({ length: 16 }, (_, index) => (
        <path
          key={index}
          d="M16 6.4v2"
          transform={`rotate(${index * 22.5} 16 17)`}
          strokeWidth="2"
        />
      ))}
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fontSize="15"
        fill="currentColor"
        stroke="none"
      >
        R
      </text>
    </g>
  ),
  java: (
    <g strokeWidth="1.1">
      <path d="M17 5c4 3-7 3-3 6m5-4c3 2-5 3-2 5M10 14h10l-1 6h-7Zm10 1c5-1 4 4-1 3M9 22c3 2 12 2 15-1M11 25h10" />
    </g>
  ),
  docker: (
    <g stroke="none" fill="#299bcc">
      <path d="M5 17h20c1 0 2-.5 3-1-1-1-2-1-3-1 .5-2-.5-3-1.5-4-.8 1.5-1 3-.5 4H5Zm0 1h20c-1 6-5 8-11 8-5 0-8-3-9-8Z" />
      <path d="M7 12h4v4H7zm5 0h4v4h-4zm5 0h4v4h-4zm-5-5h4v4h-4zm5 0h4v4h-4zm0-5h4v4h-4z" />
      <circle cx="8" cy="19.5" r=".8" fill="white" />
    </g>
  ),

  pdf: (
    <path
      d="M15.5 6.5c-2.6 0-.5 6.8 2.5 10.1 2.1 2.3 5.7 3.7 5.7 1.6 0-2.9-10.1-1.9-14.7 2.1-3.1 2.7-.8 4.2 1.6 1.3 3.2-3.9 7.6-15.1 4.9-15.1Z"
      strokeWidth="1.3"
    />
  ),
  code: <path d="m12 11-3 3 3 3m8-6 3 3-3 3m-3-7-2 10" />,
  webpage: (
    <>
      <rect x="6" y="7" width="20" height="16" rx="2" />
      <path d="M6 12h20m-17 4h5v4H9zm8 0h6m-6 4h6" />
      <path d="M9 9.5h.01m3-.01h.01m3-.01h.01" strokeWidth="1.8" />
    </>
  ),
  terminal: (
    <>
      <rect
        x="7"
        y="8"
        width="18"
        height="14"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
      <path d="m10 12 4 3-4 3m7 0h5" stroke="white" />
    </>
  ),
  markdown: (
    <>
      <path d="M8 18v-7l3.5 4 3.5-4v7m6-7v7m-3-3 3 3 3-3" />
    </>
  ),
  lines: <path d="M9 11h9m-9 4h14m-14 4h11" />,
  braces: <path d="M13 10h-2v3l-2 2 2 2v3h2m6-10h2v3l2 2-2 2v3h-2" />,
  sliders: (
    <>
      <path d="M8 10h16M8 15h16M8 20h16" />
      <circle cx="12" cy="10" r="1.8" fill="#f6f6f4" />
      <circle cx="20" cy="15" r="1.8" fill="#f6f6f4" />
      <circle cx="14" cy="20" r="1.8" fill="#f6f6f4" />
    </>
  ),
  branch: (
    <>
      <circle cx="12" cy="10" r="2" />
      <circle cx="12" cy="20" r="2" />
      <circle cx="21" cy="12" r="2" />
      <path d="M12 12v6m9-4v1c0 4-9 0-9 3" />
    </>
  ),
  boxes: (
    <>
      <path d="M9 13h5v5H9zm6 0h5v5h-5zm0-6h5v5h-5zm6 6h4v5h-4zM8 20h16" />
    </>
  ),
  database: (
    <>
      <path d="M8 11v9c0 4 16 4 16 0v-9Z" fill="currentColor" stroke="none" />
      <ellipse
        cx="16"
        cy="10"
        rx="8"
        ry="3"
        fill="currentColor"
        stroke="#eeedf8"
        strokeWidth=".7"
      />
      <path
        d="M8 15c0 4 16 4 16 0m-16 4c0 4 16 4 16 0"
        stroke="#eeedf8"
        strokeWidth=".8"
      />
    </>
  ),
  grid: (
    <>
      <rect x="9" y="10" width="14" height="11" rx=".5" />
      <path d="M14 10v11m-5-7h14m-14 4h14" />
    </>
  ),
  chart: (
    <>
      <path d="M17 8v7h7a7 7 0 0 0-7-7Z" fill="currentColor" stroke="none" />
      <path
        d="M14 10a6 6 0 1 0 7 8h-7Z"
        fill="currentColor"
        stroke="none"
        opacity=".8"
      />
    </>
  ),
  zip: (
    <>
      <path d="M14 3v14m4-14v14" stroke="#a7abb0" strokeWidth="2" />
      <path
        d="M14 5h2m0 2h2m-4 2h2m0 2h2m-4 2h2m0 2h2"
        stroke="#565e67"
        strokeWidth="1.6"
      />
      <rect
        x="13"
        y="17"
        width="6"
        height="8"
        rx="2"
        fill="#c3c7cb"
        stroke="#6e7781"
        strokeWidth="1"
      />
      <path d="M15 20h2v2h-2Z" stroke="#6e7781" strokeWidth=".8" />
    </>
  ),
  image: (
    <>
      <rect
        x="7"
        y="8"
        width="18"
        height="16"
        rx="2"
        fill="#79b8d1"
        stroke="none"
      />
      <circle cx="21" cy="12" r="2.4" fill="#f4d36c" stroke="none" />
      <path d="m7 21 7-10 8 13H9a2 2 0 0 1-2-2Z" fill="#448278" stroke="none" />
      <path d="m12 24 8-9 5 7a2 2 0 0 1-2 2Z" fill="#639b7e" stroke="none" />
    </>
  ),
  audio: (
    <>
      <path d="M14 18V9l8-2v9m-8-4 8-2" />
      <ellipse cx="11.5" cy="18.5" rx="2.5" ry="2" />
      <ellipse cx="19.5" cy="16.5" rx="2.5" ry="2" />
    </>
  ),
  play: <path d="m12 9 11 6-11 6Z" fill="currentColor" stroke="none" />,
  font: (
    <text
      x="16"
      y="20"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
      fontSize="13"
      fontFamily="Georgia, serif"
    >
      Aa
    </text>
  ),
};

export function AttachmentFileIcon({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  const type = attachmentFileType(name);
  const id = useId();
  const languageArtwork = (
    {
      PY: "python",
      RS: "rust",
      JAVA: "java",
      CSS: "braces",
      HTML: "webpage",
      DOCK: "docker",
    } as Partial<Record<string, keyof typeof glyphs>>
  )[type.label];
  const glyph = languageArtwork ?? type.glyph;
  const languageBand = type.family === "code" && !languageArtwork;
  const colorBand =
    languageBand ||
    ["pdf", "document", "slides"].includes(type.family) ||
    ["XLS", "XLSX"].includes(type.label);
  const unlabelled =
    ["python", "rust", "docker", "markdown", "branch", "font"].includes(
      glyph,
    ) || type.label === "HTML";
  const largeArtwork = unlabelled;
  const label =
    type.family === "image" && /\.png$/i.test(name) ? "PNG" : type.label;
  return (
    <svg
      className="attachment-file-icon"
      data-file-type={type.family}
      data-file-label={type.label}
      data-file-artwork={glyph}
      width={size}
      height={size}
      viewBox="0 0 32 36"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-paper`} x2="0" y2="1">
          <stop stopColor="#fffefa" />
          <stop offset="1" stopColor="#e4e6e8" />
        </linearGradient>
      </defs>
      <path
        d="M4.5 1.5H21l9 9V32a2.5 2.5 0 0 1-2.5 2.5h-23A2.5 2.5 0 0 1 2 32V4a2.5 2.5 0 0 1 2.5-2.5Z"
        fill={`url(#${id}-paper)`}
        stroke="#aeb5bd"
        strokeWidth=".65"
      />
      <path d="m21 1.5 9 9h-7a2 2 0 0 1-2-2Z" fill="#d4d8dd" />
      <g
        fill="none"
        stroke="currentColor"
        color={type.color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {!languageBand && (
          <g
            transform={
              largeArtwork
                ? "translate(-2 1) scale(1.12)"
                : glyph === "zip"
                  ? "translate(0 -2)"
                  : undefined
            }
          >
            {glyphs[glyph]}
          </g>
        )}
      </g>
      {colorBand && (
        <path
          d={
            languageBand
              ? "M2 19h28v13a2.5 2.5 0 0 1-2.5 2.5h-23A2.5 2.5 0 0 1 2 32Z"
              : "M2 25h28v7a2.5 2.5 0 0 1-2.5 2.5h-23A2.5 2.5 0 0 1 2 32Z"
          }
          fill={type.color}
        />
      )}
      {!unlabelled && (
        <text
          x="16"
          y={languageBand ? "29.5" : "31.8"}
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
          fontSize={
            languageBand
              ? label.length > 3
                ? 8
                : 10
              : label.length > 3
                ? 6.3
                : 7.6
          }
          fontWeight="700"
          fill={
            colorBand ? (type.label === "JS" ? "#29251d" : "white") : type.color
          }
        >
          {label}
        </text>
      )}
    </svg>
  );
}
