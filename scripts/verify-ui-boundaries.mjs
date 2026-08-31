import { readFile, readdir } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const FORBIDDEN_ARTEMIS_PACKAGES = new Set([
  "@artemis/agent-host",
  "@artemis/desktop",
  "@artemis/platform",
  "@artemis/protocol",
]);

const AREAS = [
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
      "react",
      "react-dom",
    ],
  },
];

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function moduleReferences(source) {
  const references = [];
  const staticPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gu;
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) references.push(match[1]);
  }
  return references;
}

function bareImportAllowed(specifier, allowed) {
  return allowed.some(
    (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
  );
}

function inspectSource(area, file, sourceRoot, source) {
  const violations = [];
  const add = (message) =>
    violations.push(`${relative(sourceRoot, file)}: ${message}`);

  if (/\bwindow\s*\.\s*artemis\b/u.test(source))
    add("window.artemis is forbidden");
  if (/\b(?:Buffer|__dirname|__filename|process)\b/u.test(source)) {
    add("Node globals are forbidden");
  }
  if (/\brequire\s*(?:\.|\()/u.test(source))
    add("CommonJS require is forbidden");
  if (/@import\b/u.test(source)) add("CSS @import is forbidden");
  if (
    area.pureContract &&
    /\bHTMLElement\b|\b(?:document|navigator|window)\s*(?:\.|\[)/u.test(source)
  ) {
    add("theme-contract must not depend on DOM globals or types");
  }

  for (const dynamic of source.matchAll(/\bimport\s*\(([^)]*)\)/gu)) {
    if (!/^\s*["'][^"']+["']\s*$/u.test(dynamic[1] ?? "")) {
      add("computed dynamic import is forbidden");
    }
  }

  for (const specifier of moduleReferences(source)) {
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (
      FORBIDDEN_ARTEMIS_PACKAGES.has(packageName) ||
      packageName === "electron" ||
      packageName?.startsWith("node:")
    ) {
      add(`forbidden dependency: ${specifier}`);
      continue;
    }
    if (specifier.includes("/src/") || specifier.endsWith("/src")) {
      add(`private source import is forbidden: ${specifier}`);
      continue;
    }
    if (isAbsolute(specifier)) {
      add(`absolute import is forbidden: ${specifier}`);
      continue;
    }
    if (specifier.startsWith(".")) {
      const target = resolve(dirname(file), specifier);
      if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${sep}`)) {
        add(`relative traversal leaves the package source: ${specifier}`);
      }
      continue;
    }
    if (!bareImportAllowed(specifier, area.allowedBare)) {
      add(`bare import is not on the layer allowlist: ${specifier}`);
    }
  }
  return violations;
}

async function manifestViolations(root) {
  const readJson = async (path) =>
    JSON.parse(await readFile(join(root, path), "utf8"));
  const violations = [];
  const rootManifest = await readJson("package.json");
  const contract = await readJson("packages/theme-contract/package.json");
  const ui = await readJson("packages/ui/package.json");
  const theme = await readJson("packages/theme-artemis/package.json");
  const gallery = await readJson("apps/ui-gallery/package.json");
  const desktop = await readJson("apps/desktop/package.json");

  if (contract.dependencies !== undefined) {
    violations.push(
      "packages/theme-contract/package.json: runtime dependencies are forbidden",
    );
  }
  for (const [path, manifest] of [
    ["packages/theme-contract/package.json", contract],
    ["packages/ui/package.json", ui],
    ["packages/theme-artemis/package.json", theme],
  ]) {
    if (manifest.private !== true) {
      violations.push(`${path}: public UI workspaces must remain private`);
    }
  }
  if (ui.dependencies !== undefined) {
    violations.push(
      "packages/ui/package.json: bundled runtime dependencies are forbidden",
    );
  }
  if (
    JSON.stringify(Object.keys(ui.peerDependencies ?? {}).sort()) !==
    JSON.stringify(["react", "react-dom"])
  ) {
    violations.push(
      "packages/ui/package.json: React and ReactDOM must be the only peers",
    );
  }
  if (
    JSON.stringify(theme.dependencies ?? {}) !==
    JSON.stringify({ "@artemis/theme-contract": rootManifest.version })
  ) {
    violations.push(
      "packages/theme-artemis/package.json: theme-contract must be the only dependency",
    );
  }
  if (gallery.private !== true) {
    violations.push(
      "apps/ui-gallery/package.json: Gallery must remain private",
    );
  }
  const desktopDependencySections = [
    desktop.dependencies,
    desktop.devDependencies,
    desktop.optionalDependencies,
    desktop.peerDependencies,
  ];
  if (
    desktopDependencySections.some(
      (dependencies) => "@artemis/ui-gallery" in (dependencies ?? {}),
    )
  ) {
    violations.push(
      "apps/desktop/package.json: Desktop must not depend on Gallery",
    );
  }
  return violations;
}

export async function verifyUiBoundaries(root = defaultRoot) {
  const violations = await manifestViolations(root);
  for (const area of AREAS) {
    const sourceRoot = join(root, area.source);
    for (const file of await filesBelow(sourceRoot)) {
      const source = await readFile(file, "utf8");
      violations.push(...inspectSource(area, file, sourceRoot, source));
    }
  }
  return violations;
}

async function main() {
  const rootArgument = process.argv.indexOf("--root");
  const root =
    rootArgument === -1
      ? defaultRoot
      : resolve(process.argv[rootArgument + 1] ?? "");
  const violations = await verifyUiBoundaries(root);
  if (violations.length > 0) {
    console.error(
      ["UI boundary verification failed:", ...violations].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  console.log("UI boundary verification passed");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
