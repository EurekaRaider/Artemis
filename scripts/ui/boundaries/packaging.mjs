import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { Minimatch } from "minimatch";
import { sanitizeFileName } from "builder-util/out/filename.js";
import { pathInside, realPathInside } from "./resources.mjs";

export const BUILDER_RESOURCE_FIELDS = [
  "files",
  "asarUnpack",
  "extraResources",
  "extraFiles",
];

export const BUILDER_PLATFORM_LEVELS = ["mac", "mas", "masDev", "win", "linux"];

export const FILE_SET_FIELDS = new Set(["filter", "from", "to"]);

export const BUILDER_ARCHES = ["ia32", "x64", "armv7l", "arm64", "universal"];

export const BUILDER_PLATFORMS = [
  { os: "mac", platform: "darwin" },
  { os: "win", platform: "win32" },
  { os: "linux", platform: "linux" },
];

export function isOwnRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeBuilderResource(value, field, path, violations) {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  const normalized = [];
  for (const [index, entry] of entries.entries()) {
    const entryPath = Array.isArray(value) ? `${path}[${index}]` : path;
    if (typeof entry === "string") {
      normalized.push({ path: entryPath, pattern: entry });
      continue;
    }
    if (field === "asarUnpack" || !isOwnRecord(entry)) {
      violations.push(
        `${entryPath}: Desktop builder ${field} entry must be a string${field === "asarUnpack" ? "" : " or FileSet"}`,
      );
      continue;
    }
    const unknownFields = Object.keys(entry).filter(
      (key) => !FILE_SET_FIELDS.has(key),
    );
    if (unknownFields.length > 0) {
      violations.push(
        `${entryPath}: Desktop builder FileSet has unknown fields: ${unknownFields.join(", ")}`,
      );
      continue;
    }
    if (entry.from !== undefined && typeof entry.from !== "string") {
      violations.push(`${entryPath}.from: expected a string`);
      continue;
    }
    if (entry.to !== undefined && typeof entry.to !== "string") {
      violations.push(`${entryPath}.to: expected a string`);
      continue;
    }
    const filters =
      entry.filter === undefined
        ? []
        : Array.isArray(entry.filter)
          ? entry.filter
          : [entry.filter];
    if (filters.some((filter) => typeof filter !== "string")) {
      violations.push(`${entryPath}.filter: expected a string or string array`);
      continue;
    }
    normalized.push({
      filters,
      from: entry.from ?? ".",
      path: entryPath,
    });
  }
  return normalized;
}

export function builderMacroMetadata(rootManifest, desktop) {
  const config = desktop.build ?? {};
  const version = desktop.version ?? rootManifest.version;
  const buildNumber =
    config.buildNumber ||
    process.env.BUILD_NUMBER ||
    process.env.TRAVIS_BUILD_NUMBER ||
    process.env.APPVEYOR_BUILD_NUMBER ||
    process.env.CIRCLE_BUILD_NUM ||
    process.env.BUILD_BUILDNUMBER ||
    process.env.CI_PIPELINE_IID;
  const buildVersion =
    config.buildVersion ??
    `${version}${buildNumber === undefined || String(buildNumber).trim().length === 0 ? "" : `.${buildNumber}`}`;
  const productName = config.productName ?? desktop.productName ?? desktop.name;
  const prerelease = String(version).match(/-([0-9A-Za-z-]+)/u)?.[1];
  return {
    buildNumber: String(buildNumber),
    buildVersion: String(buildVersion),
    channel: prerelease ?? "latest",
    name: String(desktop.name),
    productName: sanitizeFileName(String(productName)),
    version: String(version),
  };
}

export function builderContexts(levelPath) {
  const platformName = levelPath.split(".")[1];
  const platforms =
    platformName === "mac" ||
    platformName === "mas" ||
    platformName === "masDev"
      ? BUILDER_PLATFORMS.filter(({ os }) => os === "mac")
      : platformName === "win"
        ? BUILDER_PLATFORMS.filter(({ os }) => os === "win")
        : platformName === "linux"
          ? BUILDER_PLATFORMS.filter(({ os }) => os === "linux")
          : BUILDER_PLATFORMS;
  return platforms.flatMap((platform) =>
    BUILDER_ARCHES.map((arch) => ({ ...platform, arch })),
  );
}

export function expandBuilderPattern(pattern, context, metadata) {
  let unsupported = false;
  const expanded = pattern.replace(
    /\$\{([_a-zA-Z./*+]+)\}/gu,
    (macro, name) => {
      const values = {
        arch: context.arch,
        os: context.os,
        platform: context.platform,
        productName: metadata.productName,
        ...metadata,
      };
      if (name in values) return values[name];
      unsupported = true;
      return macro;
    },
  );
  return unsupported || expanded.includes("${") ? undefined : expanded;
}

export function normalizeBuilderPattern(pattern) {
  let normalized = pattern.replace(/\\/gu, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  return posix.normalize(normalized);
}

export function minimatchHasMagic(pattern) {
  if (pattern.set.length > 1) return true;
  return pattern.set[0].some((part) => typeof part !== "string");
}

export function parsedBuilderPatterns(patterns) {
  const effective =
    patterns.length === 0 ||
    patterns.every((pattern) => pattern.startsWith("!"))
      ? ["**/*", ...patterns]
      : patterns;
  const parsed = [];
  for (const pattern of effective) {
    const matcher = new Minimatch(pattern, { dot: true });
    parsed.push(matcher);
    if (!pattern.includes(".") && !minimatchHasMagic(matcher)) {
      parsed.push(new Minimatch(`${pattern}/**/*`, { dot: true }));
    }
  }
  return parsed;
}

export function builderPatternsInclude(path, patterns, isDirectory = false) {
  let match = false;
  for (const pattern of patterns) {
    if (match !== pattern.negate) continue;
    match = pattern.match(path, isDirectory && !pattern.negate);
  }
  return match;
}

export async function galleryEntries(root) {
  const galleryRoot = join(root, "apps/ui-gallery");
  const entries = [{ isDirectory: true, path: galleryRoot }];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      entries.push({ isDirectory: entry.isDirectory(), path });
      if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(galleryRoot);
  return entries;
}

export async function builderPatternsTargetGallery(
  root,
  base,
  patterns,
  context,
  metadata,
) {
  const expanded = [];
  for (const pattern of patterns) {
    const value = expandBuilderPattern(pattern, context, metadata);
    if (value === undefined) return undefined;
    const normalized = normalizeBuilderPattern(value);
    expanded.push(normalized);
    if (!normalized.startsWith("!") && !builderPathHasMagic(normalized)) {
      const target = isAbsolute(normalized)
        ? resolve(normalized)
        : resolve(base, normalized);
      if (
        pathInside(target, join(root, "apps/ui-gallery")) ||
        (await realPathInside(target, join(root, "apps/ui-gallery")))
      ) {
        return true;
      }
    }
  }
  let parsed;
  try {
    parsed = parsedBuilderPatterns(expanded);
  } catch {
    return undefined;
  }
  for (const entry of await galleryEntries(root)) {
    if (entry.isDirectory) continue;
    const candidate = relative(base, entry.path).split(sep).join("/");
    if (builderPatternsInclude(candidate, parsed, entry.isDirectory))
      return true;
  }
  return false;
}

export function builderPathHasMagic(path) {
  try {
    return minimatchHasMagic(new Minimatch(path, { dot: true }));
  } catch {
    return true;
  }
}

export async function builderPathDetails(path, galleryRoot) {
  const lexicalInside = pathInside(path, galleryRoot);
  const lexicalAncestor = pathInside(galleryRoot, path);
  let realInside = false;
  let realAncestor = false;
  let canonicalChanged = false;
  try {
    const [realTarget, realGallery] = await Promise.all([
      realpath(path),
      realpath(galleryRoot),
    ]);
    canonicalChanged = resolve(realTarget) !== resolve(path);
    realInside = pathInside(realTarget, realGallery);
    realAncestor = pathInside(realGallery, realTarget);
  } catch {
    // Lexical checks still apply to paths not present at verification time.
  }
  return {
    canonicalChanged,
    lexicalAncestor,
    lexicalInside,
    realAncestor,
    realInside,
  };
}

export function resolveBuilderPath(pattern, base, context, metadata) {
  const expanded = expandBuilderPattern(pattern, context, metadata);
  if (
    expanded === undefined ||
    expanded.startsWith("!") ||
    builderPathHasMagic(expanded)
  ) {
    return undefined;
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

export async function builderResourceViolations(root, rootManifest, desktop) {
  const violations = [];
  const projectDir = join(root, "apps/desktop");
  const galleryRoot = join(root, "apps/ui-gallery");
  const metadata = builderMacroMetadata(rootManifest, desktop);
  const allContexts = builderContexts("build");
  const configuredAppDir = desktop.build?.directories?.app;
  if (
    configuredAppDir !== undefined &&
    configuredAppDir !== null &&
    typeof configuredAppDir !== "string"
  ) {
    violations.push(
      "apps/desktop/package.json: build.directories.app must be a string",
    );
  }
  const appDirs = new Map();
  const appDir =
    typeof configuredAppDir === "string"
      ? resolve(projectDir, configuredAppDir)
      : projectDir;
  const appDirDetails = await builderPathDetails(appDir, galleryRoot);
  if (
    appDirDetails.lexicalInside ||
    appDirDetails.lexicalAncestor ||
    appDirDetails.realInside ||
    appDirDetails.realAncestor
  ) {
    violations.push(
      "apps/desktop/package.json: build.directories.app must not overlap Gallery",
    );
  }
  for (const context of allContexts) {
    const key = `${context.os}:${context.arch}`;
    appDirs.set(key, appDir);
  }
  const levels = [
    ["build", desktop.build],
    ...BUILDER_PLATFORM_LEVELS.map((name) => [
      `build.${name}`,
      desktop.build?.[name],
    ]),
  ];
  const validLevels = new Map();
  for (const [levelPath, level] of levels) {
    if (level === undefined || level === null) continue;
    if (!isOwnRecord(level)) {
      violations.push(
        `apps/desktop/package.json: ${levelPath} must be an object`,
      );
      continue;
    }
    validLevels.set(levelPath, level);
  }
  const buildLevel = validLevels.get("build") ?? {};
  for (const platformName of BUILDER_PLATFORM_LEVELS) {
    const levelPath = `build.${platformName}`;
    const contexts = builderContexts(levelPath);
    const platformLevel = validLevels.get(levelPath);
    for (const field of BUILDER_RESOURCE_FIELDS) {
      const sources = [
        ["build", buildLevel[field]],
        ...(platformLevel === undefined
          ? []
          : [[levelPath, platformLevel[field]]]),
      ];
      const entries = sources.flatMap(([sourcePath, value]) =>
        normalizeBuilderResource(
          value,
          field,
          `apps/desktop/package.json: ${sourcePath}.${field}`,
          violations,
        ),
      );
      const fieldPath = `apps/desktop/package.json: build + ${levelPath}.${field}`;
      const patternEntries = entries.filter(
        (entry) => entry.pattern !== undefined,
      );
      const fileSetEntries = entries.filter(
        (entry) => entry.pattern === undefined,
      );
      for (const context of contexts) {
        const key = `${context.os}:${context.arch}`;
        const appDir = appDirs.get(key);
        if (appDir === undefined) continue;
        const base =
          field === "files" || field === "asarUnpack" ? appDir : projectDir;
        if (patternEntries.length > 0) {
          const targetsGallery = await builderPatternsTargetGallery(
            root,
            base,
            patternEntries.map(({ pattern }) => pattern),
            context,
            metadata,
          );
          if (targetsGallery === undefined) {
            violations.push(`${fieldPath}: unsupported file macro or glob`);
          } else if (targetsGallery) {
            violations.push(
              `${fieldPath}: Desktop builder ${field} patterns include Gallery`,
            );
          }
        }
        for (const entry of fileSetEntries) {
          const source = resolveBuilderPath(
            entry.from,
            base,
            context,
            metadata,
          );
          if (source === undefined) {
            violations.push(
              `${entry.path}.from: unsupported file macro, glob, or negation`,
            );
            continue;
          }
          const details = await builderPathDetails(source, galleryRoot);
          if (
            details.lexicalInside ||
            details.realInside ||
            (details.realAncestor && !details.lexicalAncestor)
          ) {
            violations.push(
              `${entry.path}.from: Desktop builder FileSet must not resolve inside or through Gallery: ${entry.from}`,
            );
            continue;
          }
          const targetsGallery = await builderPatternsTargetGallery(
            root,
            source,
            entry.filters,
            context,
            metadata,
          );
          if (targetsGallery === undefined) {
            violations.push(
              `${entry.path}.filter: unsupported file macro or glob`,
            );
          } else if (targetsGallery) {
            violations.push(
              `${entry.path}: Desktop builder FileSet filters include Gallery`,
            );
          }
        }
      }
    }
  }
  for (const [name, value] of [
    ["build.directories.output", desktop.build?.directories?.output],
    [
      "build.directories.buildResources",
      desktop.build?.directories?.buildResources,
    ],
  ]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      violations.push(`apps/desktop/package.json: ${name} must be a string`);
      continue;
    }
    for (const context of allContexts) {
      const target = resolveBuilderPath(value, projectDir, context, metadata);
      if (target === undefined) {
        violations.push(
          `apps/desktop/package.json: ${name} contains an unsupported file macro, glob, or negation`,
        );
      } else {
        const details = await builderPathDetails(target, galleryRoot);
        if (!details.lexicalInside && !details.realInside) continue;
        violations.push(
          `apps/desktop/package.json: ${name} must not reference Gallery: ${value}`,
        );
      }
    }
  }
  return violations;
}

export async function manifestViolations(root) {
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
  violations.push(
    ...(await builderResourceViolations(root, rootManifest, desktop)),
  );
  return violations;
}
