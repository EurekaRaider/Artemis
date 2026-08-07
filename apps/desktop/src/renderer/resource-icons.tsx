import {
  BrowserIcon,
  BrowsersIcon,
  BugIcon,
  CalendarDotsIcon,
  CloudIcon,
  CodeIcon,
  DatabaseIcon,
  EnvelopeIcon,
  FigmaLogoIcon,
  FileDocIcon,
  FileMagnifyingGlassIcon,
  FilePdfIcon,
  FilePptIcon,
  FileXlsIcon,
  FilmStripIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GithubLogoIcon,
  GitPullRequestIcon,
  GlobeSimpleIcon,
  GraphIcon,
  ImageIcon,
  LightbulbIcon,
  LightningIcon,
  ListChecksIcon,
  MagicWandIcon,
  MagnifyingGlassPlusIcon,
  PackageIcon,
  PaletteIcon,
  PencilSimpleLineIcon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
  TestTubeIcon,
  ToolboxIcon,
  UsersThreeIcon,
  WaveSineIcon,
  type Icon,
} from "@phosphor-icons/react";

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

export type ResourceIconName =
  | "agents"
  | "browser"
  | "bug"
  | "calendar"
  | "checklist"
  | "cloud"
  | "code"
  | "code-review"
  | "codegraph"
  | "connector"
  | "database"
  | "document"
  | "email"
  | "figma"
  | "file-search"
  | "filesystem"
  | "git-branch"
  | "github"
  | "image"
  | "lightbulb"
  | "lightning"
  | "mcp"
  | "motion"
  | "package"
  | "palette"
  | "pdf"
  | "plugin"
  | "presentation"
  | "skill"
  | "skill-authoring"
  | "skill-search"
  | "spreadsheet"
  | "terminal"
  | "test"
  | "toolbox"
  | "verify"
  | "video"
  | "web-video";

export interface ResourceIconPalette {
  background: string;
  surface: string;
  foreground: string;
  accent: string;
  border: string;
}

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
    terms: ["find-docs", "search-docs", "documentation-search"],
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
  { icon: "motion", terms: ["gsap", "animation", "motion"] },
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

const RESOURCE_ICONS: Record<ResourceIconName, Icon> = {
  agents: UsersThreeIcon,
  browser: BrowserIcon,
  bug: BugIcon,
  calendar: CalendarDotsIcon,
  checklist: ListChecksIcon,
  cloud: CloudIcon,
  code: CodeIcon,
  "code-review": GitPullRequestIcon,
  codegraph: GraphIcon,
  connector: GlobeSimpleIcon,
  database: DatabaseIcon,
  document: FileDocIcon,
  email: EnvelopeIcon,
  figma: FigmaLogoIcon,
  "file-search": FileMagnifyingGlassIcon,
  filesystem: FolderOpenIcon,
  "git-branch": GitBranchIcon,
  github: GithubLogoIcon,
  image: ImageIcon,
  lightbulb: LightbulbIcon,
  lightning: LightningIcon,
  mcp: PlugsConnectedIcon,
  motion: WaveSineIcon,
  package: PackageIcon,
  palette: PaletteIcon,
  pdf: FilePdfIcon,
  plugin: PuzzlePieceIcon,
  presentation: FilePptIcon,
  skill: MagicWandIcon,
  "skill-authoring": PencilSimpleLineIcon,
  "skill-search": MagnifyingGlassPlusIcon,
  spreadsheet: FileXlsIcon,
  terminal: TerminalWindowIcon,
  test: TestTubeIcon,
  toolbox: ToolboxIcon,
  verify: ShieldCheckIcon,
  video: FilmStripIcon,
  "web-video": BrowsersIcon,
};

function palette(
  background: string,
  surface: string,
  foreground: string,
  accent: string,
  border: string,
): ResourceIconPalette {
  return { background, surface, foreground, accent, border };
}

const RESOURCE_ICON_PALETTES: Record<ResourceIconName, ResourceIconPalette> = {
  agents: palette("#0b4a53", "#16707a", "#f3ffff", "#8ee89b", "#237681"),
  browser: palette("#123a61", "#1f6291", "#f5fbff", "#56c8ff", "#2b6f9f"),
  bug: palette("#6e211f", "#a13a34", "#fff7f2", "#ffbd63", "#ad4b43"),
  calendar: palette("#53346f", "#7a51a0", "#fff8ff", "#ff9fb0", "#8760aa"),
  checklist: palette("#174577", "#28659a", "#f8fcff", "#ffd05e", "#3473a6"),
  cloud: palette("#174d78", "#2d79ad", "#f4fbff", "#8edcff", "#3987ba"),
  code: palette("#252f44", "#40506c", "#f7f9ff", "#7de2ca", "#4b5d78"),
  "code-review": palette("#43286f", "#6c4aa0", "#fff9ff", "#75d7ff", "#7857ad"),
  codegraph: palette("#183c5b", "#265f83", "#f4fcff", "#7ce6c3", "#337094"),
  connector: palette("#6b3415", "#a25722", "#fff9ef", "#ffd36f", "#b4662d"),
  database: palette("#184c44", "#27786a", "#f1fffb", "#87e2ca", "#348678"),
  document: palette("#16499a", "#2870d4", "#ffffff", "#8fc6ff", "#367ddd"),
  email: palette("#743131", "#ae4d4d", "#fff9f7", "#ffc766", "#bb5b59"),
  figma: palette("#273449", "#3f5069", "#ffffff", "#ff7262", "#4d5f77"),
  "file-search": palette("#59407a", "#8562aa", "#fffaff", "#ff9dc5", "#9270b7"),
  filesystem: palette("#6f4a16", "#a67628", "#fff9e9", "#ffd766", "#b58435"),
  "git-branch": palette("#172f46", "#28506e", "#f4fbff", "#5fc8ff", "#365e7a"),
  github: palette("#24272d", "#454a54", "#ffffff", "#a8b3c5", "#555b66"),
  image: palette("#704028", "#a6623d", "#fffaf5", "#ffb9d1", "#b37049"),
  lightbulb: palette("#142d50", "#234b78", "#fff9dc", "#ffd85e", "#305987"),
  lightning: palette("#312a73", "#5148a0", "#fffbd9", "#ffe25d", "#5f57ad"),
  mcp: palette("#174e46", "#287a6d", "#f0fffb", "#70e0b5", "#35897a"),
  motion: palette("#1d235e", "#353d91", "#fff9db", "#ff70ba", "#444ca0"),
  package: palette("#694118", "#9a6827", "#fff8e8", "#ffc55c", "#a97832"),
  palette: palette("#4d3470", "#7650a1", "#fff9ff", "#ff7f91", "#8460ae"),
  pdf: palette("#9d1e28", "#df2c38", "#ffffff", "#ff9d86", "#e53d47"),
  plugin: palette("#283746", "#425b70", "#f7fbff", "#7cc8ff", "#50697c"),
  presentation: palette("#a8440d", "#eb6417", "#ffffff", "#ffd070", "#ef7328"),
  skill: palette("#43336e", "#6952a0", "#fffaff", "#a7e2ff", "#7760ac"),
  "skill-authoring": palette(
    "#7a313f",
    "#b14c5c",
    "#fff8f8",
    "#ffc36c",
    "#be5a68",
  ),
  "skill-search": palette(
    "#7b481b",
    "#b97531",
    "#fff9ea",
    "#ffd65f",
    "#c4823d",
  ),
  spreadsheet: palette("#087a3d", "#0baa57", "#ffffff", "#91e7aa", "#1bb463"),
  terminal: palette("#183b62", "#2a5c8b", "#ffffff", "#89d1ff", "#376b99"),
  test: palette("#135349", "#237d6f", "#f1fffb", "#a1e575", "#318b7c"),
  toolbox: palette("#175047", "#28786b", "#f3fffb", "#ffb55e", "#37877a"),
  verify: palette("#195539", "#2e8059", "#f3fff7", "#a4e872", "#3c8e67"),
  video: palette("#16464e", "#23717d", "#f1ffff", "#45e0ba", "#31808b"),
  "web-video": palette("#145263", "#20849a", "#f2ffff", "#54e3b6", "#3192a6"),
};

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

export function resourceIconPalette(
  icon: ResourceIconName,
): ResourceIconPalette {
  return RESOURCE_ICON_PALETTES[icon];
}

export function SemanticResourceIcon({ icon }: { icon: ResourceIconName }) {
  const IconComponent = RESOURCE_ICONS[icon];
  return (
    <IconComponent
      aria-hidden="true"
      className="resource-semantic-icon"
      weight="duotone"
    />
  );
}
