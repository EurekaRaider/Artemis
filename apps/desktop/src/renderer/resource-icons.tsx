import { ArtemisIcon, type ArtemisIconName } from "@artemis/ui/icons";

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
  "image",
  "lightbulb",
  "lightning",
  "mcp",
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
  { icon: "video", terms: ["gsap", "animation", "motion"] },
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

// Resource artwork uses solid silhouettes at avatar sizes; toolbar glyphs stay unchanged.
export function ResourceArtwork({ icon }: { icon: ResourceIconName }) {
  const artwork = (() => {
    switch (icon) {
      case "terminal":
        return (
          <>
            <path
              d="m9 10 6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="17" y="21" width="8" height="3" rx="1.5" />
          </>
        );
      case "codegraph":
        return (
          <>
            <path
              d="m10 17 13-9M10 17l13 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <circle cx="8" cy="17" r="4" />
            <circle cx="24" cy="7" r="4" />
            <circle cx="24" cy="25" r="4" />
          </>
        );
      case "lightbulb":
        return (
          <>
            <path d="M16 4a9 9 0 0 0-6 15.7c1.2 1.1 1.6 2 1.6 3.3h8.8c0-1.3.4-2.2 1.6-3.3A9 9 0 0 0 16 4Z" />
            <rect x="12" y="25" width="8" height="3" rx="1.5" />
          </>
        );
      case "agents":
        return (
          <>
            <circle cx="12" cy="11" r="5" />
            <path d="M3 27v-3a9 9 0 0 1 18 0v3Z" />
            <circle cx="24" cy="12" r="4" opacity=".5" />
            <path d="M23 20c4 0 7 3 7 7h-6v-3c0-1.4-.3-2.8-1-4Z" opacity=".5" />
          </>
        );
      case "palette":
        return (
          <>
            <path d="M17 4C9 4 4 9 4 16s5 12 11 12c3 0 4-2 3-4-1-3 0-4 3-4h2c8 0 7-16-6-16Z" />
            <g fill="var(--resource-tile)">
              <circle cx="10" cy="12" r="2" />
              <circle cx="17" cy="9" r="2" />
              <circle cx="23" cy="13" r="2" />
              <circle cx="9" cy="19" r="2" />
            </g>
          </>
        );
      case "checklist":
        return (
          <>
            <rect x="5" y="3" width="23" height="27" rx="4" opacity=".18" />
            <path
              d="m8 10 2 2 3-4m-5 12 2 2 3-4M17 11h6M17 21h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        );
      case "file-search":
        return (
          <>
            <path d="M6 3h13l7 7v18H6Z" opacity=".2" />
            <path d="M19 3v8h7" />
            <circle
              cx="14"
              cy="18"
              r="4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <path
              d="m18 22 4 4"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </>
        );
      case "skill":
      case "skill-search":
        return (
          <>
            <path d="m16 3 3.8 9.2L29 16l-9.2 3.8L16 29l-3.8-9.2L3 16l9.2-3.8Z" />
            <circle cx="26" cy="6" r="3" opacity=".4" />
          </>
        );
      case "mcp":
      case "connector":
        return (
          <>
            <path
              d="m7 17 8-8a5 5 0 0 1 7 7l-4 4M25 15l-8 8a5 5 0 0 1-7-7l4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </>
        );
      default:
        return undefined;
    }
  })();
  if (!artwork) return <SemanticResourceIcon icon={icon} />;
  return (
    <svg
      aria-hidden="true"
      className="resource-artwork"
      viewBox="0 0 32 32"
      fill="currentColor"
    >
      {artwork}
    </svg>
  );
}
