import { useId } from "react";
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

// Avatar artwork has its own color and silhouette; toolbar glyphs stay unchanged.
export function ResourceArtwork({ icon }: { icon: ResourceIconName }) {
  const gradientId = useId();
  const paint = `url(#${gradientId})`;
  const artwork = (() => {
    switch (icon) {
      case "lightbulb":
        return (
          <>
            <defs>
              <linearGradient id={gradientId} x2=".8" y2="1">
                <stop stopColor="#fff282" />
                <stop offset="1" stopColor="#ffad19" />
              </linearGradient>
            </defs>
            <path
              d="M32 9c-10 0-17 7-17 17 0 7 4 11 8 15l2 8h14l2-8c4-4 8-8 8-15 0-10-7-17-17-17"
              fill={paint}
            />
            <path d="M25 49h14v5c0 4-14 4-14 0Z" fill="#adc2dc" />
            <path
              d="m27 32 5 5 5-5m-5 5v11"
              fill="none"
              stroke="#fff7c0"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M21 24c0-6 5-10 10-10"
              fill="none"
              stroke="#fff4be"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M32 2v3M8 13l3 3M53 13l3-3M6 30h4M54 30h4"
              stroke="#ffd557"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </>
        );
      case "palette":
        return (
          <>
            <defs>
              <linearGradient id={gradientId} x2=".8" y2="1">
                <stop stopColor="#fff6e9" />
                <stop offset="1" stopColor="#e9d7c8" />
              </linearGradient>
            </defs>
            <path
              d="M34 7C18 5 7 16 7 31c0 16 14 26 25 25 5 0 7-4 4-8-3-5-1-9 5-9h5c18 0 13-29-12-32Z M31 46a4 3.5 0 1 0-8 0 4 3.5 0 1 0 8 0Z"
              fillRule="evenodd"
              fill={paint}
            />
            <circle cx="20" cy="21" r="5" fill="#ff6869" />
            <circle cx="33" cy="16" r="5" fill="#ffcf42" />
            <circle cx="46" cy="24" r="5" fill="#46c2ff" />
            <circle cx="16" cy="35" r="5" fill="#9568f7" />
          </>
        );
      case "file-search":
        return (
          <>
            <defs>
              <linearGradient id={gradientId} x2=".8" y2="1">
                <stop stopColor="#f5fbff" />
                <stop offset="1" stopColor="#cbe6ff" />
              </linearGradient>
            </defs>
            <rect
              x="11"
              y="7"
              width="34"
              height="46"
              rx="6"
              fill="#2587ee"
              transform="rotate(-9 28 30)"
            />
            <path
              d="M19 5h24l11 11v35a5 5 0 0 1-5 5H19a5 5 0 0 1-5-5V10a5 5 0 0 1 5-5"
              fill={paint}
            />
            <path d="M43 5v8a3 3 0 0 0 3 3h8" fill="#89c8ff" />
            <path
              d="M22 19h12M22 25h8"
              stroke="#62a4e2"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle
              cx="36"
              cy="37"
              r="10"
              fill="#c5eaff"
              stroke="#1979e8"
              strokeWidth="4"
            />
            <path
              d="m44 45 10 10"
              stroke="#1979e8"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </>
        );
      case "checklist":
        return (
          <>
            <defs>
              <linearGradient id={gradientId} x2=".8" y2="1">
                <stop stopColor="#5ce297" />
                <stop offset="1" stopColor="#069856" />
              </linearGradient>
            </defs>
            <rect x="10" y="7" width="44" height="51" rx="7" fill={paint} />
            <rect x="15" y="12" width="34" height="41" rx="4" fill="#edfff5" />
            <rect x="23" y="4" width="18" height="10" rx="4" fill="#83efb1" />
            <path
              d="m21 25 3 3 5-6m-8 19 3 3 5-6"
              stroke="#16a966"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M35 26h7M35 42h7"
              stroke="#83b9a0"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        );
      case "git-branch":
        return (
          <>
            <defs>
              <linearGradient id={gradientId} x2=".8" y2="1">
                <stop stopColor="#ff9855" />
                <stop offset="1" stopColor="#f14b29" />
              </linearGradient>
            </defs>
            <rect
              x="11"
              y="10"
              width="42"
              height="42"
              rx="10"
              fill={paint}
              transform="rotate(45 32 31)"
            />
            <path
              d="M25 20v19a5 5 0 0 0 5 5m-5-18 14 10"
              stroke="#fff3de"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <circle cx="25" cy="20" r="4" fill="#fff3de" />
            <circle cx="39" cy="36" r="4" fill="#fff3de" />
            <circle cx="30" cy="44" r="4" fill="#fff3de" />
          </>
        );
      case "lightning":
        return (
          <>
            <defs>
              <linearGradient id={gradientId} x2=".8" y2="1">
                <stop stopColor="#ddff7b" />
                <stop offset="1" stopColor="#91e332" />
              </linearGradient>
            </defs>
            <path
              d="M7 17c0-4 3-7 7-7h35c4 0 7 3 7 7v30c0 4-3 7-7 7H14c-4 0-7-3-7-7Z"
              fill="#21252a"
              stroke="#3c434b"
            />
            <path d="m37 5-23 29h16l-5 25 26-33H35Z" fill={paint} />
            <path
              d="M13 22H4M11 42H2"
              stroke="#b8f750"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        );
      case "agents":
        return (
          <>
            <circle cx="45" cy="23" r="8" fill="#ffc65c" />
            <path d="M34 53V43a11 11 0 0 1 22 0v10Z" fill="#f7a73c" />
            <circle cx="25" cy="20" r="10" fill="#ffb08a" />
            <path d="M9 55V43a16 16 0 0 1 32 0v12Z" fill="#f16d45" />
            <path
              d="M15 42c0-5 4-9 9-9"
              fill="none"
              stroke="#ffc7a5"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </>
        );
      case "skill":
        return (
          <>
            <path
              d="m29 6 7 18 18 7-18 7-7 18-7-18-18-7 18-7Z"
              fill="#a17aff"
            />
            <path d="m29 6 7 18 18 7H29Z" fill="#c6b1ff" />
            <path
              d="m51 5 2.5 6.5L60 14l-6.5 2.5L51 23l-2.5-6.5L42 14l6.5-2.5Z"
              fill="#ffc858"
            />
          </>
        );
      case "skill-search":
        return (
          <>
            <circle
              cx="27"
              cy="27"
              r="18"
              fill="#e7dbff"
              stroke="#9464eb"
              strokeWidth="5"
            />
            <path
              d="m41 41 14 14"
              stroke="#9464eb"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d="m27 15 3.5 8.5L39 27l-8.5 3.5L27 39l-3.5-8.5L15 27l8.5-3.5Z"
              fill="#9a6cf0"
            />
          </>
        );
      case "toolbox":
        return (
          <>
            <path
              d="M23 19v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7"
              fill="none"
              stroke="#71b6ed"
              strokeWidth="4"
            />
            <rect x="7" y="18" width="50" height="37" rx="7" fill="#227fe0" />
            <path
              d="M7 25a7 7 0 0 1 7-7h36a7 7 0 0 1 7 7v9H7Z"
              fill="#67b8f7"
            />
            <rect x="27" y="29" width="10" height="10" rx="2" fill="#ffcf5c" />
          </>
        );
      case "video":
        return (
          <>
            <rect x="7" y="12" width="50" height="40" rx="8" fill="#9363e6" />
            <path
              d="M7 20a8 8 0 0 1 8-8h34a8 8 0 0 1 8 8v6H7Z"
              fill="#b697fa"
            />
            <path d="m27 29 13 8-13 8Z" fill="#fff4e8" />
          </>
        );
      case "terminal":
        return (
          <>
            <rect x="5" y="10" width="54" height="44" rx="8" fill="#273347" />
            <path
              d="m16 24 10 9-10 9"
              fill="none"
              stroke="#85e3b5"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M34 42h12"
              stroke="#a7c8f0"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </>
        );
      case "codegraph":
        return (
          <>
            <path
              d="m17 32 29-17M17 32l29 17"
              stroke="#7c9cc7"
              strokeWidth="5"
            />
            <circle cx="15" cy="32" r="9" fill="#50acf7" />
            <circle cx="47" cy="13" r="8" fill="#b08bfa" />
            <circle cx="47" cy="51" r="8" fill="#51d7ad" />
          </>
        );
      case "mcp":
      case "connector":
        return (
          <>
            <path
              d="m14 34 16-16a10 10 0 0 1 14 14l-8 8"
              fill="none"
              stroke="#31b8cf"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d="m50 30-16 16a10 10 0 0 1-14-14l8-8"
              fill="none"
              stroke="#5bd6ae"
              strokeWidth="7"
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
      viewBox="0 0 64 64"
      fill="none"
    >
      {artwork}
    </svg>
  );
}
