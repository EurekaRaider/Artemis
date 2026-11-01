import { useEffect, useId, useState, type CSSProperties } from "react";
import { ArtemisIcon, type ArtemisIconName } from "@artemis/ui/icons";
import { pluginBrandIcon } from "./plugin-brand-icons.js";

export type ResourceIconKind =
  | "plugin"
  | "plugins"
  | "skill"
  | "skills"
  | "mcp"
  | "connector"
  | "connectors"
  | "app"
  | "apps";

export const RESOURCE_ICON_NAMES = [
  "slack",
  "search",
  "target",
  "review",
  "agent",
  "edit",
  "shield",
  "chat",
  "rocket",
  "book",
  "wand",
  "chart",
  "translate",
  "server",

  "agents",
  "browser",
  "bug",
  "calendar",
  "checklist",
  "cloud",
  "code",
  "code-review",
  "codegraph",
  "connector",
  "database",
  "document",
  "email",
  "figma",
  "file-search",
  "filesystem",
  "folder",
  "git-branch",
  "github",
  "hook-plugin",
  "image",
  "lightbulb",
  "lightning",
  "mcp",
  "monitor",
  "package",
  "palette",
  "pdf",
  "plugin",
  "presentation",
  "skill",
  "skill-authoring",
  "skill-search",
  "spreadsheet",
  "terminal",
  "test",
  "toolbox",
  "verify",
  "video",
  "web-video",
] as const satisfies readonly ArtemisIconName[];

export type ResourceIconName = (typeof RESOURCE_ICON_NAMES)[number];

interface ResourceIconOptions {
  id?: string | undefined;
  description?: string | undefined;
  pluginName?: string | undefined;
  command?: string | undefined;
  transport?: string | undefined;
}
const PURPOSE_RULES: readonly {
  icon: ResourceIconName;
  terms: readonly string[];
}[] = [
  {
    icon: "lightbulb",
    terms: ["brainstorm", "idea", "ideation", "头脑风暴", "构思"],
  },
  {
    icon: "checklist",
    terms: ["plan", "planning", "roadmap", "todo", "计划", "规划"],
  },
  { icon: "target", terms: ["goal", "okr", "objective", "目标"] },
  {
    icon: "edit",
    terms: ["write", "writing", "copy", "blog", "essay", "写作", "文案"],
  },
  {
    icon: "document",
    terms: ["doc", "docx", "document", "word", "readme", "文档"],
  },
  {
    icon: "spreadsheet",
    terms: ["xlsx", "sheet", "csv", "excel", "spreadsheet", "表格"],
  },
  {
    icon: "presentation",
    terms: ["pptx", "slides", "deck", "presentation", "演示"],
  },
  {
    icon: "book",
    terms: ["docs", "reference", "knowledge", "paper", "wiki", "文献", "资料"],
  },
  {
    icon: "search",
    terms: ["search", "find", "research", "discover", "lookup", "搜索", "调研"],
  },
  {
    icon: "palette",
    terms: ["design", "frontend", "ui", "ux", "css", "figma", "taste", "设计"],
  },
  {
    icon: "code",
    terms: ["code", "implement", "refactor", "typescript", "build", "代码"],
  },
  {
    icon: "test",
    terms: ["test", "tdd", "qa", "verify", "spec", "测试", "验证"],
  },
  {
    icon: "bug",
    terms: ["debug", "bug", "fix", "crash", "diagnose", "调试", "修复"],
  },
  {
    icon: "review",
    terms: ["review", "code-review", "pr", "feedback", "评审"],
  },
  {
    icon: "git-branch",
    terms: ["git", "branch", "commit", "merge", "worktree", "分支", "提交"],
  },
  {
    icon: "rocket",
    terms: ["deploy", "release", "ship", "publish", "launch", "发布", "部署"],
  },
  {
    icon: "terminal",
    terms: ["shell", "cli", "bash", "script", "command", "终端", "命令"],
  },
  {
    icon: "browser",
    terms: ["browser", "web", "scrape", "playwright", "url", "网页"],
  },
  {
    icon: "monitor",
    terms: ["computer-use", "desktop", "screen", "click", "桌面"],
  },
  {
    icon: "agent",
    terms: ["agent", "subagent", "parallel", "dispatch", "智能体"],
  },
  {
    icon: "chart",
    terms: ["data", "analytics", "chart", "metrics", "report", "数据", "分析"],
  },
  {
    icon: "database",
    terms: ["sql", "database", "postgres", "sqlite", "db", "数据库"],
  },
  {
    icon: "email",
    terms: ["mail", "email", "gmail", "outlook", "inbox", "邮件"],
  },
  {
    icon: "calendar",
    terms: ["calendar", "schedule", "meeting", "event", "日程", "会议"],
  },
  {
    icon: "chat",
    terms: ["slack", "chat", "message", "im", "lark", "feishu", "消息"],
  },
  {
    icon: "shield",
    terms: ["security", "secret", "audit", "permission", "auth", "安全"],
  },
  {
    icon: "image",
    terms: ["image", "photo", "video", "audio", "media", "图片", "视频"],
  },
  {
    icon: "wand",
    terms: ["generate", "creative", "art", "canvas", "prompt", "生成", "创作"],
  },
  {
    icon: "translate",
    terms: ["translate", "i18n", "locale", "language", "翻译"],
  },
];
const exactBrands = [
  "github",
  "figma",
  "slack",
  "atlassian",
  "gmail",
  "google-workspace",
  "linear",
  "notion",
  "outlook",
  "qq-mail",
];
const normalized = (text: string) =>
  text.normalize("NFKC").toLowerCase().trim();
export function resourceBrandName(
  name: string,
  command = "",
): string | undefined {
  // Match complete service/package tokens; e.g. github-helper is not GitHub.
  const tokens = [
    normalized(name),
    ...command
      .toLowerCase()
      .split(/\s+/)
      .map((token) =>
        token
          .replace(/^.*\//, "")
          .replace(/@[^@]*$/, "")
          .replace(/^(?:mcp-server-|server-)/, ""),
      ),
  ];
  return exactBrands.find((brand) => tokens.includes(brand));
}
function purpose(text: string): ResourceIconName | undefined {
  const value = normalized(text);
  const words = value.split(/[^\p{L}\p{N}]+/u);
  return PURPOSE_RULES.find((rule) =>
    rule.terms.some((term) =>
      /[^\x00-\x7F]/.test(term)
        ? term === "数据"
          ? value.replaceAll("数据库", "").includes(term)
          : value.includes(term)
        : term.includes("-")
          ? value.includes(term)
          : words.includes(term) ||
            (term !== "doc" && words.includes(`${term}s`)),
    ),
  )?.icon;
}
const cache = new Map<string, { input: string; icon: ResourceIconName }>();
export function resourceIconName(
  name: string,
  kind: ResourceIconKind,
  options: ResourceIconOptions = {},
): ResourceIconName {
  const input = JSON.stringify([
    name,
    kind,
    options.description,
    options.pluginName,
    options.command,
    options.transport,
  ]);
  if (options.id && cache.get(options.id)?.input === input)
    return cache.get(options.id)!.icon;
  const result = resolveIcon(name, kind, options);
  if (options.id) {
    if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
    cache.set(options.id, { input, icon: result });
  }
  return result;
}
function resolveIcon(
  name: string,
  kind: ResourceIconKind,
  options: ResourceIconOptions,
): ResourceIconName {
  if (options.pluginName) return resolveIcon(options.pluginName, "plugin", {});
  const brand = resourceBrandName(
    name,
    kind === "mcp" ? options.command : undefined,
  );
  if (brand === "github" || brand === "figma" || brand === "slack")
    return brand;
  if (kind === "mcp") {
    const tokens = normalized(`${name} ${options.command ?? ""}`)
      .split(/[\s/@]+/)
      .map((token) => token.replace(/^(?:mcp-server-|server-)/, ""));
    if (tokens.includes("filesystem")) return "folder";
    if (
      tokens.some((token) =>
        ["postgres", "postgresql", "sqlite", "mysql"].includes(token),
      )
    )
      return "database";
    if (
      tokens.some((token) =>
        ["playwright", "puppeteer", "chrome-devtools"].includes(token),
      )
    )
      return "browser";
    if (tokens.includes("memory")) return "book";
    return options.transport && options.transport !== "stdio"
      ? "server"
      : "mcp";
  }
  const value = normalized(name);
  if (/computer[- ]?use/.test(value)) return "monitor";
  if (value === "find-docs" || value === "context7") return "book";
  if (value.includes("code-review")) return "review";
  if (value === "systematic-debugging") return "bug";
  if (value === "brainstorming") return "lightbulb";
  if (
    value.startsWith("hyperframes") ||
    value === "remotion" ||
    value === "gsap" ||
    value === "website-to-hyperframes"
  )
    return value.endsWith("-cli") ? "terminal" : "image";
  if (value === "pdf") return "document";
  if (value === "office") return "document";
  return (
    purpose(name) ??
    purpose((options.description ?? "").split(/[.!?。！？]/u)[0] ?? "") ??
    (kind === "plugin" || kind === "plugins"
      ? "plugin"
      : ["connector", "connectors", "app", "apps"].includes(kind)
        ? "connector"
        : "skill")
  );
}

export function SemanticResourceIcon({ icon }: { icon: ResourceIconName }) {
  return <ArtemisIcon className="resource-semantic-icon" name={icon} />;
}
export function ResourceArtwork({ icon }: { icon: ResourceIconName }) {
  return <SemanticResourceIcon icon={icon} />;
}
function pluginHue(name: string): number {
  const icon = resourceIconName(name, "plugin");
  if (icon === "document" || name === "office") return 255;
  if (icon === "spreadsheet") return 150;
  if (icon === "presentation") return 55;
  if (icon === "palette") return 300;
  if (icon === "monitor") return 225;
  return 215;
}
export function ResourceAvatar({
  brandColor,
  iconKey,
  iconDataUrl,
  kind,
  name,
  pluginName,
  description,
  id,
  command,
  transport,
  disabled = false,
}: ResourceIconOptions & {
  brandColor?: string | undefined;
  iconKey?: ResourceIconName | undefined;
  iconDataUrl?: string | undefined;
  kind: ResourceIconKind;
  name: string;
  disabled?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const brandMaskId = useId();
  useEffect(() => setImageFailed(false), [iconDataUrl]);
  const owner =
    pluginName ?? (kind === "plugin" || kind === "plugins" ? name : undefined);
  const semanticIcon = owner
    ? resourceIconName(owner, "plugin")
    : (iconKey ??
      resourceIconName(name, kind, { id, description, command, transport }));
  const brand =
    !owner && resourceBrandName(name, kind === "mcp" ? command : undefined);
  const brandImage = brand && pluginBrandIcon(brand);
  const brandMaskSlope = brand === "linear" ? 2 : brand === "notion" ? -1 : -5;
  const brandMaskIntercept =
    brand === "linear" ? -0.6 : brand === "notion" ? 1 : 4.5;
  const imageSource =
    (!imageFailed && iconDataUrl) || (owner && pluginBrandIcon(owner));
  const style = owner
    ? ({
        "--resource-plugin-hue": pluginHue(owner),
        ...(brandColor ? { "--resource-brand": brandColor } : {}),
      } as CSSProperties)
    : undefined;
  return (
    <span
      className="resource-avatar"
      data-icon={semanticIcon}
      data-kind={kind}
      data-plugin={owner ? "true" : undefined}
      data-disabled={disabled || undefined}
      style={style}
    >
      {imageSource ? (
        <img
          alt=""
          draggable={false}
          onError={() => setImageFailed(true)}
          src={imageSource}
        />
      ) : brand === "figma" || brand === "github" ? (
        <ArtemisIcon
          className="resource-semantic-icon"
          name={brand}
          fallback={
            brand === "github" ? (
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            ) : undefined
          }
          style={{ fill: "currentColor", stroke: "none" }}
        />
      ) : brandImage &&
        (brand === "linear" ||
          brand === "notion" ||
          brand === "outlook" ||
          brand === "qq-mail") ? (
        <svg
          aria-hidden="true"
          className="resource-semantic-icon"
          focusable="false"
          viewBox="0 0 24 24"
        >
          <defs>
            <filter
              id={`${brandMaskId}-contrast`}
              colorInterpolationFilters="sRGB"
            >
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                {/* Remove Linear's dark plate and the other marks' white areas. */}
                <feFuncR
                  type="linear"
                  slope={brandMaskSlope}
                  intercept={brandMaskIntercept}
                />
                <feFuncG
                  type="linear"
                  slope={brandMaskSlope}
                  intercept={brandMaskIntercept}
                />
                <feFuncB
                  type="linear"
                  slope={brandMaskSlope}
                  intercept={brandMaskIntercept}
                />
              </feComponentTransfer>
            </filter>
            <mask
              id={brandMaskId}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="24"
              height="24"
              style={{ maskType: "luminance" }}
            >
              <image
                href={brandImage}
                width="24"
                height="24"
                filter={`url(#${brandMaskId}-contrast)`}
              />
            </mask>
          </defs>
          <rect
            width="24"
            height="24"
            fill="currentColor"
            mask={`url(#${brandMaskId})`}
          />
        </svg>
      ) : brandImage ? (
        <span
          className="resource-brand-mark"
          style={{ maskImage: `url("${brandImage}")` }}
        />
      ) : (
        <ResourceArtwork icon={semanticIcon} />
      )}
    </span>
  );
}
