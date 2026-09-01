import { extname, join, relative } from "node:path";
import { readdir, readFile } from "node:fs/promises";

export const DESKTOP_SKIN_FORBIDDEN_MARKERS = Object.freeze([
  "com.artemis.synthetic-stress",
  "Synthetic Stress",
  "stress-skin-fixture",
  "dist-renderer-skin-smoke",
  "__ARTEMIS_SKIN_SMOKE",
  "artemis-dedicated-skin-smoke",
  "skin-smoke-style",
  "@artemis/ui-gallery",
]);

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
  ".xml",
  ".yml",
  ".yaml",
]);

function markerHits(value) {
  return DESKTOP_SKIN_FORBIDDEN_MARKERS.filter((marker) =>
    value.includes(marker),
  );
}

async function filesBelow(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(candidate)));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}

export async function desktopSkinLeakage(root) {
  const findings = [];
  for (const path of await filesBelow(root)) {
    const displayPath = relative(root, path) || path;
    for (const marker of markerHits(displayPath)) {
      findings.push({ path: displayPath, marker, location: "path" });
    }
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const source = await readFile(path, "utf8");
    for (const marker of markerHits(source)) {
      findings.push({ path: displayPath, marker, location: "content" });
    }
  }
  return findings;
}

export function desktopSkinAsarLeakage(asar, archivePath) {
  const findings = [];
  for (const entry of asar.listPackage(archivePath)) {
    for (const marker of markerHits(entry)) {
      findings.push({ path: entry, marker, location: "asar-path" });
    }
    if (!TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) continue;
    const normalizedEntry = entry.replace(/^\/+/, "");
    const fileInfo = asar.statFile(archivePath, normalizedEntry);
    if ("files" in fileInfo || "link" in fileInfo) continue;
    const source = asar
      .extractFile(archivePath, normalizedEntry)
      .toString("utf8");
    for (const marker of markerHits(source)) {
      findings.push({ path: entry, marker, location: "asar-content" });
    }
  }
  return findings;
}

export function desktopSkinPackagingConfigurationIssues(packageManifest) {
  const issues = [];
  const files = packageManifest?.build?.files;
  if (!Array.isArray(files)) {
    issues.push("electron-builder files must be an explicit array");
  } else {
    const required = ["dist-electron/**/*", "dist-renderer/**/*"];
    for (const pattern of required) {
      if (!files.includes(pattern)) issues.push(`missing ${pattern}`);
    }
    for (const pattern of files) {
      if (
        typeof pattern === "string" &&
        !pattern.startsWith("!") &&
        (pattern.includes("skin-smoke") ||
          pattern.includes("ui-gallery") ||
          /(?:^|\/)tests?(?:\/|$)/u.test(pattern))
      ) {
        issues.push(`forbidden packaged file pattern ${pattern}`);
      }
    }
  }
  const resources = packageManifest?.build?.extraResources;
  if (!Array.isArray(resources)) {
    issues.push("electron-builder extraResources must be an explicit array");
  } else {
    for (const resource of resources) {
      const source = typeof resource === "string" ? resource : resource?.from;
      if (
        typeof source !== "string" ||
        source !== "resources" ||
        source.includes("skin-smoke") ||
        source.includes("ui-gallery")
      ) {
        issues.push(`forbidden extraResource source ${String(source)}`);
      }
    }
  }
  return issues;
}
