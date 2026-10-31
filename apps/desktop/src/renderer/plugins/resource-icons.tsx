import { useEffect, useState, type CSSProperties } from "react";
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

interface ResourceIconRule {
  icon: ResourceIconName;
  terms: readonly string[];
}

const RESOURCE_ICON_RULES: readonly ResourceIconRule[] = [
  { icon: "monitor", terms: ["computer-use", "computeruse"] },
  { icon: "web-video", terms: ["website-to-hyperframes"] },
  {
    icon: "terminal",
    terms: [
      "hyperframes-cli",
      "node-repl",
      "terminal",
      "shell",
      "bash",
      "command-line",
      "cli",
    ],
  },
  { icon: "package", terms: ["hyperframes-registry", "registry", "package"] },
  { icon: "code-review", terms: ["code-review", "pull-request"] },
  {
    icon: "file-search",
    terms: ["context7", "find-docs", "search-docs", "documentation-search"],
  },
  {
    icon: "skill-search",
    terms: ["find-skills", "search-skills", "skill-discovery"],
  },
  {
    icon: "agents",
    terms: ["parallel-agents", "subagent", "multi-agent", "agent-team"],
  },
  {
    icon: "git-branch",
    terms: [
      "git-worktree",
      "git-worktrees",
      "development-branch",
      "git-branch",
      "git-fork",
    ],
  },
  {
    icon: "checklist",
    terms: ["executing-plans", "writing-plans", "task-plan", "project-plan"],
  },
  {
    icon: "skill-authoring",
    terms: ["writing-skills", "skill-creator", "skill-authoring"],
  },
  { icon: "verify", terms: ["verification", "security", "secure", "shield"] },
  { icon: "test", terms: ["test-driven", "testing", "test-suite"] },
  { icon: "bug", terms: ["debugging", "debugger", "diagnostic"] },
  {
    icon: "toolbox",
    terms: ["workspace-setup", "installer", "setup", "toolbox"],
  },
  { icon: "lightbulb", terms: ["brainstorming", "brainstorm", "ideation"] },
  {
    icon: "palette",
    terms: [
      "design-taste",
      "frontend-design",
      "ui-design",
      "ux-design",
      "palette",
    ],
  },
  { icon: "lightning", terms: ["gsap"] },
  { icon: "video", terms: ["animation", "motion"] },
  { icon: "video", terms: ["hyperframes", "remotion", "video", "film"] },
  { icon: "lightning", terms: ["superpowers", "lightning"] },
  { icon: "codegraph", terms: ["codegraph", "code-graph"] },
  { icon: "github", terms: ["github"] },
  { icon: "figma", terms: ["figma"] },
  { icon: "filesystem", terms: ["filesystem", "file-system", "folder"] },
  {
    icon: "database",
    terms: [
      "postgres",
      "database",
      "supabase",
      "neon",
      "sqlite",
      "mysql",
      "sql-server",
    ],
  },
  {
    icon: "browser",
    terms: ["browser", "chrome", "playwright", "web-control"],
  },
  { icon: "calendar", terms: ["calendar", "schedule"] },
  { icon: "email", terms: ["gmail", "outlook-email", "email", "mail"] },
  { icon: "cloud", terms: ["google-drive", "cloudflare", "cloud"] },
  { icon: "image", terms: ["imagegen", "image-generation", "image", "photo"] },
  { icon: "pdf", terms: ["pdf"] },
  {
    icon: "presentation",
    terms: ["presentations", "presentation", "slides", "powerpoint", "pptx"],
  },
  {
    icon: "spreadsheet",
    terms: ["spreadsheets", "spreadsheet", "sheets", "excel", "xlsx"],
  },
  {
    icon: "document",
    terms: ["documents", "document", "google-docs", "word", "docx"],
  },
  { icon: "code", terms: ["openai-docs", "developer", "coding", "code"] },
];

function normalizedResourceName(name: string): string {
  return name
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

export function resourceIconName(
  name: string,
  kind: ResourceIconKind,
): ResourceIconName {
  const normalized = normalizedResourceName(name);
  const matched = RESOURCE_ICON_RULES.find((rule) =>
    rule.terms.some((term) => normalized.includes(term)),
  );
  if (matched) return matched.icon;
  if (kind === "plugin" || kind === "plugins") return "plugin";
  if (
    kind === "connector" ||
    kind === "connectors" ||
    kind === "app" ||
    kind === "apps"
  ) {
    return "connector";
  }
  if (kind === "mcp") return "mcp";
  return "skill";
}

export function SemanticResourceIcon({ icon }: { icon: ResourceIconName }) {
  return <ArtemisIcon className="resource-semantic-icon" name={icon} />;
}

// Built-in tiles share the same luminance and chroma; third-party images stay intact.
export function ResourceArtwork({ icon }: { icon: ResourceIconName }) {
  return <SemanticResourceIcon icon={icon} />;
}

export function ResourceAvatar({
  brandColor,
  iconKey,
  iconDataUrl,
  kind,
  name,
  pluginName,
}: {
  brandColor?: string | undefined;
  iconKey?: ResourceIconName | undefined;
  iconDataUrl?: string | undefined;
  kind: ResourceIconKind;
  name: string;
  pluginName?: string | undefined;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [iconDataUrl]);
  const semanticIcon = iconKey ?? resourceIconName(name, kind);
  const bundledIcon = pluginBrandIcon(
    pluginName ?? (kind === "plugin" || kind === "plugins" ? name : ""),
  );
  const imageSource = (!imageFailed && iconDataUrl) || bundledIcon;
  const semanticVisible = !imageSource;
  const hues: Partial<Record<ResourceIconName, number>> = {
    document: 255,
    spreadsheet: 150,
    presentation: 55,
    pdf: 25,
    palette: 300,
    image: 195,
    monitor: 225,
    terminal: 150,
    browser: 225,
    mcp: 195,
    connector: 195,
    skill: 275,
  };
  const style = {
    "--resource-hue": hues[semanticIcon] ?? 275,
    ...(brandColor ? { "--resource-brand": brandColor } : {}),
  } as CSSProperties;
  return (
    <span
      className="resource-avatar"
      data-icon={semanticVisible ? semanticIcon : undefined}
      data-kind={kind}
      style={style}
    >
      {imageSource ? (
        <img
          alt=""
          draggable={false}
          onError={() => setImageFailed(true)}
          src={imageSource}
        />
      ) : (
        <ResourceArtwork icon={semanticIcon} />
      )}
    </span>
  );
}
