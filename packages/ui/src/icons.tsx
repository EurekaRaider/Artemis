import type { ReactNode, SVGProps } from "react";

export const ARTEMIS_ICON_SOURCE =
  "ui-prototype-v17:components.html#cat-icons" as const;

export const ARTEMIS_ICON_NAMES = [
  "folder",
  "folder-open",
  "files",
  "file",
  "sidebar-l",
  "sidebar-r",
  "browser",
  "terminal",
  "markdown",
  "plus",
  "close",
  "search",
  "edit",
  "trash",
  "refresh",
  "chevron",
  "chev-left",
  "chev-right",
  "queue",
  "steer",
  "move-front",
  "archive",
  "review",
  "mode",
  "usage",
  "automation",
  "resource",
  "settings",
  "gear",
  "model",
  "more",
  "block",
  "alert",
  "clock",
  "grid",
  "sun",
  "list",
  "task",
  "circle",
  "plus-circle",
  "info",
  "sparkle",
  "tool",
  "image",
  "lock",
  "attach",
  "send",
  "warning",
  "environment",
  "branch",
  "git-branch",
  "changes",
  "compare",
  "push",
  "local",
  "source",
  "mcp",
  "context",
  "check",
  "approval",
  "tool-activity",
  "workspace-tab",
  "tab-scroll",
  "token-usage",
  "review-empty",
  "agents",
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
  "github",
  "lightbulb",
  "lightning",
  "package",
  "palette",
  "pdf",
  "plugin",
  "presentation",
  "skill",
  "skill-authoring",
  "skill-search",
  "spreadsheet",
  "test",
  "toolbox",
  "verify",
  "video",
  "web",
  "web-video",
] as const;

export type ArtemisIconName = (typeof ARTEMIS_ICON_NAMES)[number];

const ARTEMIS_ICON_GLYPHS = {
  folder: (
    <path d="M3.5 6.5a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2v-10.5z" />
  ),
  "folder-open": (
    <path
      d="M3.5 6.5a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2v1M3.5 6.5v10.5m0 0a2 2 0 002 2h11.3a2 2 0 001.9-1.4l2.3-7.6a1.5 1.5 0 00-1.4-1.9H5.7a2 2 0 00-1.9 1.5l-.3 1.4z"
      transform="translate(0,-0.5)"
    />
  ),
  files: (
    <>
      <path d="M8 3.5h6l3.5 3.5v12a1.5 1.5 0 01-1.5 1.5H8A1.5 1.5 0 016.5 19V5a1.5 1.5 0 011.5-1.5z" />
      <path d="M14 3.5V7h3.5" />
      <path d="M9.5 12h5M9.5 15.5h5" />
    </>
  ),
  file: (
    <>
      <path d="M8 3.5h6l3.5 3.5v12a1.5 1.5 0 01-1.5 1.5H8A1.5 1.5 0 016.5 19V5a1.5 1.5 0 011.5-1.5z" />
      <path d="M14 3.5V7h3.5" />
    </>
  ),
  "sidebar-l": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  "sidebar-r": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  browser: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.2 3.5 5 3.5 8.5s-1.2 6.3-3.5 8.5c-2.3-2.2-3.5-5-3.5-8.5S9.7 5.7 12 3.5z" />
    </>
  ),
  terminal: <path d="M5 7.5l4.5 4.5L5 16.5M12 17h7" />,
  markdown: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M6.5 15v-6l2.5 3 2.5-3v6M15 12.5l2.5 3 2.5-3M17.5 9v6.5" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20.5 20.5L16 16" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11a2.1 2.1 0 00-3-3L5 17l-1 3z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4l.8-12" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 11a8.5 8.5 0 10.5 4" />
      <path d="M21 4.5v5h-5" />
    </>
  ),
  chevron: <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />,
  "chev-left": <path d="M14.5 6.5L9 12l5.5 5.5" />,
  "chev-right": <path d="M9.5 6.5l5.5 5.5-5.5 5.5" />,
  queue: (
    <>
      <path d="M8 6.5h12M8 12h12M8 17.5h8" />
      <circle cx="4" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  steer: (
    <>
      <path d="M4 5.5v4a4 4 0 004 4h10" />
      <path d="M14 9.5l4 4-4 4" />
    </>
  ),
  "move-front": (
    <>
      <path d="M12 17.5V6.5M8 10.5l4-4 4 4" />
      <path d="M5.5 20.5h13" />
    </>
  ),
  archive: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.5" />
      <path d="M5 8.5h14V18a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 18V8.5z" />
      <path d="M10 12.5h4" />
    </>
  ),
  review: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  mode: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 9.5l2.5 2.5-2.5 2.5M13 14.5h3" />
    </>
  ),
  usage: (
    <>
      <path d="M5.5 18.5v-6M12 18.5v-11M18.5 18.5v-8" />
      <path d="M3.5 20.5h17" opacity="0.5" />
    </>
  ),
  automation: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  resource: (
    <>
      <path d="M8 3.5v4M16 3.5v4M6 7.5h12v2.5a6 6 0 01-12 0V7.5z" />
      <path d="M12 16v3.5M9.5 20h5" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="7" cy="17" r="2" />
    </>
  ),
  gear: (
    <>
      <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  model: (
    <>
      <path
        d="M12 3.5a8.5 8.5 0 018.5 8.5 8.5 8.5 0 01-8.5 8.5A8.5 8.5 0 013.5 12 8.5 8.5 0 0112 3.5z"
        opacity="0.45"
      />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M5.5 5.5l13 13" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16.5v.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" />
    </>
  ),
  list: (
    <>
      <path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" />
      <circle cx="4.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  task: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  circle: <circle cx="12" cy="12" r="8.5" />,
  "plus-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.5v.5" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5l2.3 6.2 6.2 2.3-6.2 2.3L12 20.5l-2.3-6.2-6.2-2.3 6.2-2.3z" />
  ),
  tool: (
    <path d="M14.5 6.5a3.5 3.5 0 00-4.7 4.2L4 16.5V20h3.5l5.8-5.8a3.5 3.5 0 004.2-4.7l-2.7 2.7-2.5-.5-.5-2.5 2.7-2.7z" />
  ),
  image: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="M20.5 14.5l-4-4L6 20" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 018 0v3" />
    </>
  ),
  attach: (
    <path d="M20.5 11.5l-8 8a5 5 0 01-7-7l8-8a3.5 3.5 0 015 5l-7.5 7.5a2 2 0 01-3-3l7-7" />
  ),
  send: <path d="M20 4L10 14M20 4l-6.5 16-3.5-6-6-3.5z" />,
  warning: (
    <>
      <path d="M12 4L2.8 19.5h18.4L12 4z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  environment: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2 3.8 5 3.8 8.5s-1.3 6.5-3.8 8.5c-2.5-2-3.8-5-3.8-8.5s1.3-6.5 3.8-8.5z" />
    </>
  ),
  branch: (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="8" r="2.2" />
      <path d="M6.5 8.2v7.6M17.5 10.2c0 3.5-3 5.3-6 5.6" />
    </>
  ),
  "git-branch": (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="8" r="2.2" />
      <path d="M6.5 8.2v7.6M17.5 10.2a7 7 0 01-7 5.6" />
    </>
  ),
  changes: (
    <path d="M4 8h13M13 4.5l3.5 3.5L13 11.5M20 16H7M11 12.5L7.5 16l3.5 3.5" />
  ),
  compare: (
    <>
      <path d="M8 4.5v15M16 4.5v15" opacity="0.45" />
      <path d="M4 8.5l4-4M4 8.5l4 4M20 15.5l-4 4M20 15.5l-4-4" />
    </>
  ),
  push: (
    <>
      <path d="M12 16V4.5M8 8.5l4-4 4 4" />
      <path d="M5 19.5h14" />
    </>
  ),
  local: (
    <>
      <rect x="4" y="4.5" width="16" height="11" rx="2" />
      <path d="M2.5 19.5h19" />
    </>
  ),
  source: <path d="M8.5 8l-4 4 4 4M15.5 8l4 4-4 4" />,
  mcp: (
    <>
      <rect x="4" y="7" width="16" height="10" rx="2" />
      <path d="M8 11h.01M12 11h.01M16 11h.01" strokeWidth="2" />
      <path d="M12 17v3M9 20h6" />
    </>
  ),
  context: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  approval: (
    <>
      <path d="M12 3.5l7 2.8v5.2c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6.3l7-2.8z" />
      <path d="M9 12l2 2 4-4.5" />
    </>
  ),
  "tool-activity": (
    <>
      <path d="M14.5 6.5a3.5 3.5 0 00-4.7 4.2L4 16.5V20h3.5l5.8-5.8a3.5 3.5 0 004.2-4.7l-2.7 2.7-2.5-.5-.5-2.5 2.7-2.7z" />
      <circle cx="17.5" cy="17.5" r="3" />
    </>
  ),
  "workspace-tab": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 8.5h17M7 4.5v4" />
    </>
  ),
  "tab-scroll": (
    <>
      <path d="M9.5 6.5l5.5 5.5-5.5 5.5" strokeDasharray="2 2" />
      <circle cx="18" cy="12" r="1.5" />
    </>
  ),
  "token-usage": (
    <>
      <path d="M5.5 18.5v-6M12 18.5v-11M18.5 18.5v-8" />
      <path d="M3.5 20.5h17" opacity="0.5" />
      <circle cx="12" cy="4.5" r="1.5" />
    </>
  ),
  "review-empty": (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 12.5l2.5 2.5 5-5.5" />
    </>
  ),
  agents: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M15.5 14.2c2.7.3 5 2.2 5 4.8" />
    </>
  ),
  bug: (
    <>
      <circle cx="12" cy="13" r="5.5" />
      <path d="M12 7.5V5M8 5l2 2.5M16 5l-2 2.5M6.5 12H3.5M20.5 12h-3M7 17l-2.5 2M17 17l2.5 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </>
  ),
  checklist: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M3.5 5.5l1.2 1.2 2-2.2M3.5 11.5l1.2 1.2 2-2.2M3.5 17.5l1.2 1.2 2-2.2" />
    </>
  ),
  cloud: (
    <path d="M7 18.5a4.5 4.5 0 01-.6-8.96 5.5 5.5 0 0110.9-1.3A4 4 0 0117.5 18.5H7z" />
  ),
  code: <path d="M8.5 8l-4 4 4 4M15.5 8l4 4-4 4" />,
  "code-review": (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="8" r="2.2" />
      <path d="M6 8.2v7.6M18 10.2a6 6 0 01-6 5.6" />
      <path d="M13.5 15.5l2 2 3.5-3.5" />
    </>
  ),
  codegraph: (
    <>
      <circle cx="5.5" cy="12" r="2" />
      <circle cx="18.5" cy="6" r="2" />
      <circle cx="18.5" cy="18" r="2" />
      <path d="M7.3 10.8l9.4-4M7.3 13.2l9.4 4" />
    </>
  ),
  connector: (
    <>
      <path d="M8 8.5h8v7H8z" opacity="0.45" />
      <path d="M12 3.5v5M12 15.5v5M3.5 12h4.5M16 12h4.5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
      <path d="M4.5 6v12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V6" />
      <path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8" />
    </>
  ),
  document: (
    <>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19V5a1.5 1.5 0 011-1.5z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 13h6M9 16.5h4" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  figma: (
    <>
      <path d="M9 3.5h3v6H9a3 3 0 010-6z" />
      <path d="M12 3.5h3a3 3 0 010 6h-3v-6z" />
      <circle cx="15" cy="12.5" r="3" />
      <path d="M9 9.5h3v6H9a3 3 0 010-6z" />
      <path d="M9 15.5h3v2a3 3 0 11-3-2z" />
    </>
  ),
  "file-search": (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19V5a1.5 1.5 0 011-1.5z" />
      <path d="M14 3.5V8h4" />
      <circle cx="11" cy="13" r="2.2" />
      <path d="M12.8 14.8L15 17" />
    </>
  ),
  filesystem: (
    <>
      <path d="M3.5 6.5a2 2 0 012-2h4l2 2.5h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2v-10.5z" />
      <path d="M7 13.5h6M7 16h4" />
    </>
  ),
  github: (
    <path d="M9 19.5c-4.3 1.4-4.3-2.5-6-3M15 22v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 3.8 5.4 4.1 5.4 4.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 10.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22" />
  ),
  lightbulb: (
    <>
      <path d="M9.5 18h5M10.5 20.5h3" />
      <path d="M12 3.5a5.5 5.5 0 00-3 10c.8.6 1.5 1.6 1.7 2.5h2.6c.2-.9.9-1.9 1.7-2.5a5.5 5.5 0 00-3-10z" />
    </>
  ),
  lightning: <path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12l1-8z" />,
  package: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12L4 7.5M12 12l8-4.5M12 12v9" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 00-1 16.9c1 .2 1.5-.5 1.5-1.2 0-.5-.3-.9-.3-1.5 0-.9.7-1.5 1.6-1.5h1.7a4.5 4.5 0 004.5-4.5c0-4.6-4-8.2-9-8.2z" />
      <circle cx="8" cy="10.5" r="1" />
      <circle cx="12" cy="8" r="1" />
      <circle cx="16" cy="10.5" r="1" />
    </>
  ),
  pdf: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 19V5a1.5 1.5 0 011-1.5z" />
      <path d="M14 3.5V8h4" />
      <path
        d="M9 15.5h.9a1.3 1.3 0 000-2.6H9v4.6M13.5 12.9v4.6M13.5 12.9h.9a1.4 1.4 0 011.4 1.4v1.8a1.4 1.4 0 01-1.4 1.4h-.9"
        strokeWidth="1.2"
      />
    </>
  ),
  plugin: (
    <>
      <path
        d="M9 4.5v3a2 2 0 01-2 2H4.5v5H7a2 2 0 012 2v3h5v-3a2 2 0 012-2h3.5v-5H17a2 2 0 01-2-2v-3h-3z"
        transform="rotate(0)"
      />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" />
    </>
  ),
  presentation: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M12 16v3M8.5 21l3.5-2 3.5 2" />
    </>
  ),
  skill: (
    <>
      <path d="M12 3.5l2.3 6.2 6.2 2.3-6.2 2.3L12 20.5l-2.3-6.2-6.2-2.3 6.2-2.3z" />
      <circle cx="19" cy="5" r="1.5" />
    </>
  ),
  "skill-authoring": (
    <>
      <path d="M12 3.5l2 5.4 5.5 2-5.5 2-2 5.4-2-5.4-5.5-2 5.5-2 2-5.4z" />
      <path d="M18 15.5l3 3M17 20.5l.8-2.3 2.5-2.7" />
    </>
  ),
  "skill-search": (
    <>
      <path d="M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7-4.7-1.8 4.7-1.8L12 4z" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M19.3 19.3L21.5 21.5" />
    </>
  ),
  spreadsheet: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M3.5 9h17M3.5 14h17M9.5 9v11M15.5 9v11" />
    </>
  ),
  test: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v5L5.8 17.5a2 2 0 001.8 3h8.8a2 2 0 001.8-3L13.5 8.5v-5" />
      <path d="M8 14.5h8" />
    </>
  ),
  toolbox: (
    <>
      <rect x="3.5" y="8" width="17" height="12" rx="2" />
      <path d="M9 8V6a2 2 0 012-2h2a2 2 0 012 2v2M3.5 13h17" />
    </>
  ),
  verify: (
    <>
      <path d="M12 3.5l7 2.8v5.2c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6.3l7-2.8z" />
      <path d="M9 12l2 2 4-4.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10.5l5-3v9l-5-3" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2 3.8 5 3.8 8.5s-1.3 6.5-3.8 8.5c-2.5-2-3.8-5-3.8-8.5s1.3-6.5 3.8-8.5z" />
      <path d="M5 8h14M5 16h14" />
    </>
  ),
  "web-video": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 8.5l5 3.5-5 3.5v-7z" />
    </>
  ),
} satisfies Readonly<Record<ArtemisIconName, ReactNode>>;

export interface ArtemisIconProps extends Omit<
  SVGProps<SVGSVGElement>,
  "children"
> {
  readonly name: ArtemisIconName;
}

export function ArtemisIcon({
  height = "1em",
  name,
  width = "1em",
  ...props
}: ArtemisIconProps) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      data-artemis-icon={name}
      fill="none"
      focusable="false"
      height={height}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      width={width}
    >
      {ARTEMIS_ICON_GLYPHS[name]}
    </svg>
  );
}
