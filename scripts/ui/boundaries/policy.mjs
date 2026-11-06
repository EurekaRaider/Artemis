import { fileURLToPath } from "node:url";

export const defaultRoot = fileURLToPath(new URL("../../../", import.meta.url));

export const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".cts",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

export const SCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

export const FORBIDDEN_ARTEMIS_PACKAGES = new Set([
  "@artemis/agent-host",
  "@artemis/desktop",
  "@artemis/platform",
  "@artemis/protocol",
]);

export const NODE_GLOBAL_NAMES = new Set([
  "Buffer",
  "__dirname",
  "__filename",
  "process",
]);

export const DOM_GLOBAL_NAMES = new Set([
  "HTMLElement",
  "document",
  "navigator",
  "window",
]);

export const TRUSTED_DESKTOP_COMPUTED_IMPORT =
  "apps/desktop/src/extension/extension-worker.ts";

export const AREAS = [
  {
    name: "theme-contract",
    source: "packages/theme-contract/src",
    allowedBare: [],
    pureContract: true,
  },
  {
    name: "ui",
    source: "packages/ui/src",
    allowedBare: ["react", "react-dom"],
  },
  {
    name: "theme-artemis",
    source: "packages/theme-artemis/src",
    allowedBare: ["@artemis/theme-contract"],
  },
  {
    name: "ui-gallery",
    source: "apps/ui-gallery/src",
    allowedBare: [
      "@artemis/theme-artemis",
      "@artemis/theme-contract",
      "@artemis/ui",
      "@phosphor-icons/react",
      "react",
      "react-dom",
    ],
  },
];
