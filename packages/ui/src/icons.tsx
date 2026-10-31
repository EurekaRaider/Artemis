import {
  createContext,
  useContext,
  type ReactNode,
  type SVGProps,
} from "react";

export const ARTEMIS_ICON_SOURCE = "nocturne:Icons.dc.html" as const;

export { ARTEMIS_MARKDOWN_ICON_PATH } from "./editor-icon-paths.js";

export const ARTEMIS_ICON_NAMES = [
  "at",
  "cursor",
  "frame",
  "arrow-down",
  "reply",
  "comment",

  "plan",
  "work",
  "user",
  "update",
  "update-ready",
  "moon",
  "pause",
  "play",
  "share",
  "fork",
  "key",
  "gauge",
  "sandbox",
  "filter",
  "camera",
  "check-circle",
  "x-circle",
  "question",
  "eye",
  "artemis",
  "message",
  "mobile",
  "monitor",
  "agent-configuration",
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
  "edit-square",
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
  "hooks",
  "hook-plugin",
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
  "target",
  "download",
  "circle",
  "plus-circle",
  "info",
  "sparkle",
  "tool",
  "image",
  "lock",
  "attach",
  "unlink",
  "send",
  "warning",
  "environment",
  "layers",
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
  "approval-ask",
  "approval-agent",
  "approval-full",
  "tool-activity",
  "workspace-tab",
  "tab-scroll",
  "token-usage",
  "review-empty",
  "agents",
  "bot-add",
  "bot",
  "copy",
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
  "feishu",
  "filesystem",
  "github",
  "lightbulb",
  "lightning",
  "package",
  "palette",
  "pdf",
  "plugin",
  "presentation",
  "qr-code",
  "slack",
  "skill",
  "skill-authoring",
  "skill-search",
  "spreadsheet",
  "test",
  "toolbox",
  "verify",
  "video",
  "wecom",
  "web",
  "web-video",
] as const;

export const ARTEMIS_VISUAL_ICON_NAMES = [
  "undo",
  "expand",
  "collapse",
  "external",
  "commit",
  "pull-request",
  "worktree",
  "stop",
] as const;
export type ArtemisIconName =
  | (typeof ARTEMIS_ICON_NAMES)[number]
  | (typeof ARTEMIS_VISUAL_ICON_NAMES)[number];

const ARTEMIS_ICON_GLYPHS = {
  at: (
    <path d="M15.5 12a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z M15.5 8.5v4.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" />
  ),
  cursor: <path d="M5.5 4l13 6.2-5.6 1.7-1.7 5.6z M13 13l5.5 5.5" />,
  frame: (
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8 M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8 M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16 M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
  ),
  "arrow-down": <path d="M12 5v14 M6 13l6 6 6-6" />,
  reply: <path d="M9.5 7L4.5 12l5 5 M4.5 12H14a5.5 5.5 0 0 1 5.5 5.5V19" />,
  comment: (
    <path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-6.5L8 20v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M8 10h8 M8 13h5" />
  ),

  undo: <path d="M9 14L4.5 9.5 9 5 M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3" />,
  expand: <path d="M14.5 4H20v5.5M20 4l-5.5 5.5M9.5 20H4v-5.5M4 20l5.5-5.5" />,
  collapse: <path d="M4 14h6v6M10 14l-7 7M20 10h-6V4M14 10l7-7" />,
  external: (
    <path d="M14 4.5h5.5V10 M19.5 4.5L11 13 M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  ),
  commit: (
    <path d="M3.5 12h5 M15.5 12h5 M8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0" />
  ),
  "pull-request": (
    <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 8v12 M18 16V9.5a3 3 0 0 0-3-3h-4.5 M12.5 4L10 6.5 12.5 9" />
  ),
  worktree: <path d="M4 12h4l12-9M14 3h6v6M12 15l8 6M14 21h6v-6" />,
  stop: (
    <path
      d="M7 9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"
      fill="currentColor"
      stroke="none"
    />
  ),
  unlink: (
    <>
      <path d="m9.2 14.8 5.6-5.6" />
      <path d="M11 16.2 8.6 18.6a2.55 2.55 0 0 1-3.6-3.6l2.4-2.4" />
      <path d="M13 7.8l2.4-2.4a2.55 2.55 0 0 1 3.6 3.6l-2.4 2.4" />
    </>
  ),
  mobile: (
    <path d="M8 3.5h8a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z M11 17.5h2" />
  ),
  monitor: (
    <path d="M3.5 6A1.5 1.5 0 0 1 5 4.5h14A1.5 1.5 0 0 1 20.5 6v8.5A1.5 1.5 0 0 1 19 16H5a1.5 1.5 0 0 1-1.5-1.5z M9 20h6 M12 16v4 M10.5 7.5l4.5 2-2 .8-.8 2z" />
  ),
  artemis: <path d="M17.5 4.585a8 8 0 1 0 0 14.83a7.6 7.6 0 0 1 0-14.83Z" />,
  message: (
    <path d="M4 6.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V11a2 2 0 0 1-2 2H9.5l-3 2.5V13H6a2 2 0 0 1-2-2z M16 9h2a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2V20l-3-2.5h-3a2 2 0 0 1-2-2V15" />
  ),
  "agent-configuration": (
    <path d="M6 9.5A2.5 2.5 0 0 1 8.5 7h7A2.5 2.5 0 0 1 18 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 15.5z M12 7V4.5 M9.8 12v1 M14.2 12v1 M3.5 11.5v3 M20.5 11.5v3" />
  ),
  folder: (
    <path d="M4 7.5a2 2 0 0 1 2-2h3.2l2 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  ),
  "folder-open": (
    <path d="M4 17V7.5a2 2 0 0 1 2-2h3.2l2 2H17a2 2 0 0 1 2 2V10 M4 17l2.2-5.6a1.5 1.5 0 0 1 1.4-.9h12a1 1 0 0 1 .9 1.4l-2.1 5.5a2 2 0 0 1-1.8 1.1H5.5A1.5 1.5 0 0 1 4 17z" />
  ),
  files: (
    <>
      <path d="M8 3.5h6l3.5 3.5v12a1.5 1.5 0 01-1.5 1.5H8A1.5 1.5 0 016.5 19V5a1.5 1.5 0 011.5-1.5z" />
      <path d="M14 3.5V7h3.5" />
      <path d="M9.5 12h5M9.5 15.5h5" />
    </>
  ),
  file: (
    <path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z M13.5 3.5V8H18" />
  ),
  "sidebar-l": (
    <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M9.5 4.5v15" />
  ),
  "sidebar-r": (
    <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M14.5 4.5v15" />
  ),
  browser: (
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M3.5 12h17 M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z" />
  ),
  terminal: (
    <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M8 9.5l2.5 2.5L8 14.5 M13 15h3" />
  ),
  markdown: (
    <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z M7 15V9l2.5 3L12 9v6 M16 9v6 M14 13l2 2 2-2" />
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: (
    <path d="M4.5 11a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0 M20 20l-4.4-4.4" />
  ),
  edit: (
    <path d="M14.5 6.5l3 3 M4.5 19.5l.9-3.9L16 5a2.1 2.1 0 0 1 3 3L8.4 18.6z" />
  ),
  "edit-square": (
    <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13 M17.8 3.7a2 2 0 0 1 2.8 2.8L13 14.1l-3.6.9.9-3.6z" />
  ),
  trash: (
    <path d="M4.5 7h15 M10 4h4 M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7 M10 11v5 M14 11v5" />
  ),
  refresh: (
    <path d="M19.5 12a7.5 7.5 0 0 1-13.3 4.8 M4.5 12a7.5 7.5 0 0 1 13.3-4.8 M18.2 3.8v3.4h-3.4 M5.8 20.2v-3.4h3.4" />
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
    <path d="M4 5.5h16v3.5H4z M5.5 9v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9 M10 13h4" />
  ),
  review: (
    <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 8v12 M18 16V9.5a3 3 0 0 0-3-3h-4.5 M12.5 4L10 6.5 12.5 9" />
  ),
  mode: (
    <path d="M4 6l1.5 1.5L8.5 4.5 M12 6h8 M12 12h8 M12 18h8 M4.5 12h3 M4.5 18h3" />
  ),
  usage: <path d="M4 19.5h16 M7 16v-4 M11 16V7 M15 16v-6 M19 16V9.5" />,
  automation: (
    <path d="M17 4.5l2.5 2.5L17 9.5 M4.5 11v-1a3 3 0 0 1 3-3h12 M7 19.5L4.5 17 7 14.5 M19.5 13v1a3 3 0 0 1-3 3h-12" />
  ),
  hooks: <path d="M8 3.5v10a4.5 4.5 0 0 0 9 0V11 M14.5 13.5L17 11l2.5 2.5" />,
  "hook-plugin": (
    <path d="M8 3.5v10a4.5 4.5 0 0 0 9 0V11 M14.5 13.5L17 11l2.5 2.5" />
  ),
  resource: (
    <path d="M4.5 6A1.5 1.5 0 0 1 6 4.5h2.5A1.5 1.5 0 0 1 10 6v2.5A1.5 1.5 0 0 1 8.5 10H6a1.5 1.5 0 0 1-1.5-1.5z M14 6a1.5 1.5 0 0 1 1.5-1.5H18A1.5 1.5 0 0 1 19.5 6v2.5A1.5 1.5 0 0 1 18 10h-2.5A1.5 1.5 0 0 1 14 8.5z M4.5 15.5A1.5 1.5 0 0 1 6 14h2.5a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z M16.75 14v5.5 M14 16.75h5.5" />
  ),
  settings: (
    <path d="M4 7.5h8 M17 7.5h3 M12 7.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M4 16.5h3 M12 16.5h8 M7 16.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0" />
  ),
  gear: (
    <path d="M4 7.5h8 M17 7.5h3 M12 7.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M4 16.5h3 M12 16.5h8 M7 16.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0" />
  ),
  model: (
    <path d="M7 8a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z M10 3.5V7 M14 3.5V7 M10 17v3.5 M14 17v3.5 M3.5 10H7 M3.5 14H7 M17 10h3.5 M17 14h3.5" />
  ),
  more: (
    <path d="M5 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0 M17 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0" />
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M5.5 5.5l13 13" />
    </>
  ),
  alert: (
    <path d="M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z M12 10v3.5 M12 16.8v.1" />
  ),
  clock: (
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M12 7.5V12l3 2" />
  ),
  grid: (
    <path d="M4.5 6A1.5 1.5 0 0 1 6 4.5h2.5A1.5 1.5 0 0 1 10 6v2.5A1.5 1.5 0 0 1 8.5 10H6a1.5 1.5 0 0 1-1.5-1.5z M14 6a1.5 1.5 0 0 1 1.5-1.5H18A1.5 1.5 0 0 1 19.5 6v2.5A1.5 1.5 0 0 1 18 10h-2.5A1.5 1.5 0 0 1 14 8.5z M4.5 15.5A1.5 1.5 0 0 1 6 14h2.5a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z M16.75 14v5.5 M14 16.75h5.5" />
  ),
  sun: (
    <path d="M8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6L7 7 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4" />
  ),
  list: (
    <>
      <path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11" />
      <circle cx="4.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  target: (
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M7.5 12a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0 M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0" />
  ),
  download: <path d="M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19.5h14" />,
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
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M12 11v5 M12 7.9v.1" />
  ),
  sparkle: (
    <path d="M12 3.5l2.3 6.2 6.2 2.3-6.2 2.3L12 20.5l-2.3-6.2-6.2-2.3 6.2-2.3z" />
  ),
  tool: (
    <path d="M14.6 6.4a4 4 0 0 0-5.3 5.2L4.5 16.4v3.1h3.1l4.8-4.8a4 4 0 0 0 5.2-5.3l-2.4 2.4-2.3-.5-.5-2.3z" />
  ),
  image: (
    <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M4 16l4.5-4.5 4 4 2.5-2.5 5 4.5 M14.5 8.5a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0" />
  ),
  lock: (
    <path d="M6.5 11h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
  ),
  attach: (
    <path d="M19.5 11.5l-7.4 7.4a4.8 4.8 0 0 1-6.8-6.8l7.7-7.7a3.2 3.2 0 0 1 4.5 4.5l-7.6 7.6a1.6 1.6 0 0 1-2.3-2.3l7-7" />
  ),
  send: <path d="M20 4L10 14M20 4l-6.5 16-3.5-6-6-3.5z" />,
  warning: (
    <path d="M10.3 4.9a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z M12 10v3.5 M12 16.8v.1" />
  ),
  environment: (
    <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z M12 12l7.5-4.3 M12 12v8.5 M12 12L4.5 7.7" />
  ),
  layers: (
    <path d="M12 4l8.5 4.5L12 13 3.5 8.5z M3.5 12.5L12 17l8.5-4.5 M3.5 16.5L12 21l8.5-4.5" />
  ),
  branch: (
    <path d="M7 4v16 M15 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M17 9v.5a4.5 4.5 0 0 1-4.5 4.5H7" />
  ),
  "git-branch": (
    <path d="M7 4v16 M15 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M17 9v.5a4.5 4.5 0 0 1-4.5 4.5H7" />
  ),
  changes: (
    <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 8v12 M18 16V9.5a3 3 0 0 0-3-3h-4.5 M12.5 4L10 6.5 12.5 9" />
  ),
  compare: (
    <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 8v12 M18 16V9.5a3 3 0 0 0-3-3h-4.5 M12.5 4L10 6.5 12.5 9" />
  ),
  push: <path d="M12 20V9 M7.5 13.5L12 9l4.5 4.5 M5 4.5h14" />,
  local: <path d="M5 6.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1V15H5z M3 18.5h18" />,
  source: <path d="M8.5 8l-4 4 4 4M15.5 8l4 4-4 4" />,
  mcp: (
    <path d="M9 3.5v4 M15 3.5v4 M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z M12 16.5v4" />
  ),
  context: (
    <path d="M12 4l8.5 4.5L12 13 3.5 8.5z M3.5 12.5L12 17l8.5-4.5 M3.5 16.5L12 21l8.5-4.5" />
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  approval: (
    <path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1z" />
  ),
  "approval-ask": (
    <path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1z" />
  ),
  "approval-agent": (
    <path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1z M9 12l2.2 2.2L15.5 10" />
  ),
  "approval-full": (
    <path d="M12 3.5l7 2.6v5.4c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.1z M9 12l2.2 2.2L15.5 10" />
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
  "token-usage": <path d="M4 19.5h16 M7 16v-4 M11 16V7 M15 16v-6 M19 16V9.5" />,
  "review-empty": (
    <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 8v12 M18 16V9.5a3 3 0 0 0-3-3h-4.5 M12.5 4L10 6.5 12.5 9" />
  ),
  agents: (
    <path d="M6 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M3.5 19.5a5.5 5.5 0 0 1 11 0 M15.5 5.2a2.8 2.8 0 0 1 0 5.6 M17 14.3a5 5 0 0 1 3.5 5.2" />
  ),
  bot: (
    <path d="M6 9.5A2.5 2.5 0 0 1 8.5 7h7A2.5 2.5 0 0 1 18 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 15.5z M12 7V4.5 M9.8 12v1 M14.2 12v1 M3.5 11.5v3 M20.5 11.5v3" />
  ),
  "bot-add": (
    <>
      <rect height="10" rx="2.5" width="11" x="3.5" y="7.5" />
      <path d="M9 7.5V5.5" />
      <circle cx="9" cy="4.5" r="1" />
      <path d="M7 11.5v2" />
      <path d="M11 11.5v2" />
      <path d="M18.75 14.5v5" />
      <path d="M16.25 17h5" />
    </>
  ),
  copy: (
    <path d="M8.5 9.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
  ),
  /* Channel brand marks are filled glyphs: the element-level fill/stroke
     overrides opt out of the library's stroke system. Feishu/Lark mark is
     the official 48-grid logo (icon-park), scaled onto the 24 grid. */
  feishu: (
    <path
      d="M41.072 5.994L3.31 16.52l9.075 9.294l8.414.146l9.683-9.44q-.384-.787-.384-1.318c0-.794.311-1.422.796-1.868q1.244-1.145 2.994-.342zm1.03.734L31.578 44.49l-9.294-9.075L22.137 27l9.375-9.518a2.54 2.54 0 0 0 1.664.495c.902-.05 1.485-.596 1.759-.917a2.35 2.35 0 0 0 .567-1.649a2.57 2.57 0 0 0-.52-1.464z"
      fill="currentColor"
      stroke="none"
      transform="scale(0.5)"
    />
  ),
  slack: (
    <path
      d="M6.527 14.514A1.973 1.973 0 0 1 4.56 16.48a1.973 1.973 0 0 1-1.968-1.967c0-1.083.885-1.968 1.968-1.968h1.967zm.992 0c0-1.083.885-1.968 1.968-1.968s1.967.885 1.967 1.968v4.927a1.973 1.973 0 0 1-1.967 1.968a1.973 1.973 0 0 1-1.968-1.968zm1.968-7.987A1.973 1.973 0 0 1 7.519 4.56c0-1.083.885-1.967 1.968-1.967s1.967.884 1.967 1.967v1.968zm0 .992c1.083 0 1.967.884 1.967 1.967a1.973 1.973 0 0 1-1.967 1.968H4.56a1.973 1.973 0 0 1-1.968-1.968c0-1.083.885-1.967 1.968-1.967zm7.986 1.967c0-1.083.885-1.967 1.968-1.967s1.968.884 1.968 1.967a1.973 1.973 0 0 1-1.968 1.968h-1.968zm-.991 0a1.973 1.973 0 0 1-1.968 1.968a1.973 1.973 0 0 1-1.968-1.968V4.56c0-1.083.885-1.967 1.968-1.967s1.968.884 1.968 1.967zm-1.968 7.987c1.083 0 1.968.885 1.968 1.968a1.973 1.973 0 0 1-1.968 1.968a1.973 1.973 0 0 1-1.968-1.968v-1.968zm0-.992a1.973 1.973 0 0 1-1.968-1.967c0-1.083.885-1.968 1.968-1.968h4.927c1.083 0 1.968.885 1.968 1.968a1.973 1.973 0 0 1-1.968 1.967z"
      fill="currentColor"
      stroke="none"
    />
  ),
  /* QR: three finder squares + a dot-matrix module corner. */
  "qr-code": (
    <>
      <rect height="7" rx="1.5" width="7" x="4" y="4" />
      <rect height="7" rx="1.5" width="7" x="13" y="4" />
      <rect height="7" rx="1.5" width="7" x="4" y="13" />
      <path d="M13.5 13.5h.01M17 13.5h.01M20.5 13.5h.01M13.5 17h.01M20.5 17h.01M13.5 20.5h.01M17 20.5h.01M20.5 20.5h.01" />
    </>
  ),
  wecom: (
    <path
      d="m17.326 8.158l-.003-.007a6.6 6.6 0 0 0-1.178-1.674c-1.266-1.307-3.067-2.19-5.102-2.417a9.3 9.3 0 0 0-2.124 0h-.001c-2.061.228-3.882 1.107-5.14 2.405a6.7 6.7 0 0 0-1.194 1.682A5.7 5.7 0 0 0 2 10.657c0 1.106.332 2.218.988 3.201l.006.01c.391.594 1.092 1.39 1.637 1.83l.983.793l-.208.875l.527-.267l.708-.358l.761.225c.467.137.955.227 1.517.29h.005q.515.06 1.026.059c.355 0 .724-.02 1.095-.06a9 9 0 0 0 1.346-.258c.095.7.43 1.337.932 1.81c-.658.208-1.352.358-2.061.436c-.442.048-.883.072-1.312.072q-.627 0-1.253-.072a10.7 10.7 0 0 1-1.861-.36l-2.84 1.438s-.29.131-.44.131c-.418 0-.702-.285-.702-.704c0-.252.067-.598.128-.84l.394-1.653c-.728-.586-1.563-1.544-2.052-2.287A7.76 7.76 0 0 1 0 10.658a7.7 7.7 0 0 1 .787-3.39a8.7 8.7 0 0 1 1.551-2.19c1.61-1.665 3.878-2.73 6.359-3.006a11.3 11.3 0 0 1 2.565 0c2.47.275 4.712 1.353 6.323 3.017a8.6 8.6 0 0 1 1.539 2.192c.466.945.769 1.937.769 2.978a3.06 3.06 0 0 0-2-.005c-.001-.644-.189-1.329-.564-2.09zm4.125 6.977l-.024-.024l-.024-.018l-.024-.018l-.096-.095a4.24 4.24 0 0 1-1.169-2.192q0-.038-.006-.075l-.006-.056l-.035-.144a1.3 1.3 0 0 0-.358-.61a1.386 1.386 0 0 0-1.957 0a1.4 1.4 0 0 0 0 1.963c.191.191.418.311.668.371c.024.012.06.012.084.012q.019 0 .041.006q.023.005.042.006a4.24 4.24 0 0 1 2.231 1.186c.048.048.096.095.131.143a.323.323 0 0 0 .466 0a.35.35 0 0 0 .036-.455m-1.05 4.37l-.025.025c-.119.096-.31.096-.453-.036a.326.326 0 0 1 0-.467c.047-.036.094-.083.141-.13l.002-.002a4.27 4.27 0 0 0 1.187-2.28q.005-.024.006-.043c0-.024 0-.06.012-.084a1.386 1.386 0 0 1 2.326-.67a1.4 1.4 0 0 1 0 1.964c-.167.18-.382.299-.608.359l-.143.036l-.057.005q-.035.006-.075.007a4.2 4.2 0 0 0-2.183 1.173l-.095.096q-.009.01-.018.024t-.018.024m-4.392-1.053l.024.024l.024.018q.015.009.024.018l.096.096a4.25 4.25 0 0 1 1.169 2.19q0 .04.006.076q.005.03.006.057l.035.143c.06.228.18.443.358.611c.537.539 1.42.539 1.957 0a1.4 1.4 0 0 0 0-1.964a1.4 1.4 0 0 0-.668-.371c-.024-.012-.06-.012-.084-.012q-.018 0-.041-.006l-.042-.006a4.25 4.25 0 0 1-2.231-1.185a1.4 1.4 0 0 1-.131-.144a.323.323 0 0 0-.466 0a.325.325 0 0 0-.036.455m1.039-4.358l.024-.024a.32.32 0 0 1 .453.035a.326.326 0 0 1 0 .467c-.047.036-.094.083-.141.13l-.002.002a4.27 4.27 0 0 0-1.187 2.281l-.006.042c0 .024 0 .06-.012.084a1.386 1.386 0 0 1-2.326.67a1.4 1.4 0 0 1 0-1.963c.166-.18.381-.3.608-.36l.143-.035q.026 0 .056-.006q.037-.005.075-.006a4.2 4.2 0 0 0 2.183-1.174l.096-.095l.018-.025z"
      fill="currentColor"
      stroke="none"
    />
  ),
  bug: (
    <>
      <circle cx="12" cy="13" r="5.5" />
      <path d="M12 7.5V5M8 5l2 2.5M16 5l-2 2.5M6.5 12H3.5M20.5 12h-3M7 17l-2.5 2M17 17l2.5 2" />
    </>
  ),
  calendar: (
    <path d="M4.5 6.5A1.5 1.5 0 0 1 6 5h12a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19z M4.5 10h15 M8.5 3v4 M15.5 3v4" />
  ),
  checklist: (
    <path d="M4 6l1.5 1.5L8.5 4.5 M12 6h8 M12 12h8 M12 18h8 M4.5 12h3 M4.5 18h3" />
  ),
  cloud: (
    <path d="M7 18.5a4.5 4.5 0 01-.6-8.96 5.5 5.5 0 0110.9-1.3A4 4 0 0117.5 18.5H7z" />
  ),
  code: (
    <path d="M8.5 7.5L4 12l4.5 4.5 M15.5 7.5L20 12l-4.5 4.5 M13.5 5l-3 14" />
  ),
  "code-review": (
    <path d="M4 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M6 8v12 M18 16V9.5a3 3 0 0 0-3-3h-4.5 M12.5 4L10 6.5 12.5 9" />
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
      <path d="M9.5 7H7a5 5 0 000 10h2.5" />
      <path d="M14.5 7H17a5 5 0 010 10h-2.5" />
      <path d="M8 12h8" />
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
    <path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z M13.5 3.5V8H18 M9 12.5h6 M9 16h4.5" />
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
  lightning: <path d="M13 3L5 13.5h6L10 21l9-11h-6z" />,
  package: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12L4 7.5M12 12l8-4.5M12 12v9" />
    </>
  ),
  palette: (
    <path d="M12 3.5l5.5 6.5-3.5 10h-4L6.5 10z M12 3.5V11 M10.8 12.2a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0" />
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
    <path d="M3.5 5h17 M5 5v9.5A1.5 1.5 0 0 0 6.5 16h11a1.5 1.5 0 0 0 1.5-1.5V5 M12 16v4 M9 20h6" />
  ),
  skill: (
    <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z M5 18.5A1.5 1.5 0 0 0 6.5 20H19 M9 8.5h6" />
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
    <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M4 10h16 M4 14.5h16 M9.5 4.5v15" />
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
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M3.5 12h17 M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z" />
  ),
  "web-video": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M10 8.5l5 3.5-5 3.5v-7z" />
    </>
  ),
  plan: (
    <path d="M4 6l1.5 1.5L8.5 4.5 M12 6h8 M12 12h8 M12 18h8 M4.5 12h3 M4.5 18h3" />
  ),
  work: (
    <path d="M14.6 6.4a4 4 0 0 0-5.3 5.2L4.5 16.4v3.1h3.1l4.8-4.8a4 4 0 0 0 5.2-5.3l-2.4 2.4-2.3-.5-.5-2.3z" />
  ),
  user: (
    <path d="M8.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M5 20a7 7 0 0 1 14 0" />
  ),
  update: (
    <path d="M19.5 12a7.5 7.5 0 1 1-7.5-7.5c2.1 0 4.1.8 5.6 2.3l1.9 1.4 M19.5 4.5v3.7h-3.7 M12 15.5V9.5 M9.5 12L12 9.5l2.5 2.5" />
  ),
  "update-ready": (
    <path d="M19.5 12a7.5 7.5 0 1 1-7.5-7.5c2.1 0 4.1.8 5.6 2.3l1.9 1.4 M19.5 4.5v3.7h-3.7 M9 12.2l2.2 2.2 4-4.2" />
  ),
  moon: <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />,
  pause: <path d="M9 6.5v11 M15 6.5v11" />,
  play: (
    <path d="M7.5 5.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L8.7 5.1a.8.8 0 0 0-1.2.7z" />
  ),
  share: (
    <path d="M12 15V4.5 M7.5 9L12 4.5 16.5 9 M5 13.5v5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-5" />
  ),
  fork: (
    <path d="M5 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M15 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M10 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M7 7v1.5a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7 M12 11.5V17" />
  ),
  key: (
    <path d="M4 15.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0 M11.7 12.3L20 4 M17 7l2.5 2.5 M14.5 9.5l2 2" />
  ),
  gauge: <path d="M4.5 17a7.5 7.5 0 1 1 15 0 M12 17l3.5-5" />,
  sandbox: (
    <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z M12 12l7.5-4.3 M12 12v8.5 M12 12L4.5 7.7" />
  ),
  filter: <path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" />,
  camera: (
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
  ),
  "check-circle": (
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M8.5 12.3l2.4 2.4 4.6-4.9" />
  ),
  "x-circle": (
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M9.5 9.5l5 5 M14.5 9.5l-5 5" />
  ),
  question: (
    <path d="M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0 M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7 M12 16.9v.1" />
  ),
  eye: (
    <path d="M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0" />
  ),
} satisfies Readonly<Record<ArtemisIconName, ReactNode>>;

export type ArtemisIconGeometry =
  | { readonly type: "path"; readonly d: string; readonly fill?: boolean }
  | {
      readonly type: "circle";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly fill?: boolean;
    }
  | {
      readonly type: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
      readonly fill?: boolean;
    }
  | {
      readonly type: "line";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    };
const SkinIconContext = createContext<
  Readonly<Record<string, readonly ArtemisIconGeometry[]>>
>({});
export function ArtemisIconProvider({
  icons,
  children,
}: {
  readonly icons: Readonly<Record<string, readonly ArtemisIconGeometry[]>>;
  readonly children: ReactNode;
}) {
  return (
    <SkinIconContext.Provider value={icons}>
      {children}
    </SkinIconContext.Provider>
  );
}
function SkinIconShape({ shape }: { readonly shape: ArtemisIconGeometry }) {
  const fill = "fill" in shape && shape.fill ? "currentColor" : "none";
  switch (shape.type) {
    case "path":
      return <path d={shape.d} fill={fill} />;
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} fill={fill} />;
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
          fill={fill}
        />
      );
    case "line":
      return <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />;
  }
}

export interface ArtemisIconProps extends Omit<
  SVGProps<SVGSVGElement>,
  "children"
> {
  readonly name: ArtemisIconName;
  readonly fallback?: ReactNode;
}

export function ArtemisIcon({
  height = "1em",
  fallback,
  name,
  strokeWidth = 1.6,
  width = "1em",
  ...props
}: ArtemisIconProps) {
  const override = useContext(SkinIconContext)[name];
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
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={width}
    >
      {override
        ? override.map((shape, index) => (
            <SkinIconShape key={index} shape={shape} />
          ))
        : (fallback ?? ARTEMIS_ICON_GLYPHS[name])}
    </svg>
  );
}

/** Shared running indicator; the wrapper owns motion so SVG geometry stays stable. */
export function RunningArc({
  className = "",
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      className={`artemis-running-arc ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="8.5" opacity=".22" />
        <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
      </svg>
    </span>
  );
}
export function ArtemisLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M35 9.17A16 16 0 1 0 35 38.83A15.2 15.2 0 0 1 35 9.17Z" />
      {size >= 32 && <path d="M35 9.17V38.83" />}
    </svg>
  );
}
