import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const DATA_FILE_NAMES = [
  "manifest.json",
  "tokens.light.json",
  "tokens.dark.json",
  "tokens.contrast.json",
  "integrity.json",
];
const FORBIDDEN_CONTENT =
  /url\s*\(|@import|https?:\/\/|data:|<(?:html|script|style)\b/iu;

function parseCli(args) {
  let packagePath;
  let packageSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--package") {
      if (packageSeen) {
        throw new Error("CLI error: duplicate --package flag");
      }
      packageSeen = true;
      const value = args[index + 1];
      if (
        value === undefined ||
        value.startsWith("--") ||
        value.trim().length === 0
      ) {
        throw new Error("CLI error: --package requires a non-empty path");
      }
      packagePath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`CLI error: unknown flag ${argument}`);
    }
    throw new Error(`CLI error: unexpected positional argument ${argument}`);
  }
  return packagePath;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function contractApi() {
  return import(
    pathToFileURL(join(root, "packages/theme-contract/dist/index.js")).href
  );
}

async function verifyFileMap(label, files) {
  const contract = await contractApi();
  const manifestText = files.get("manifest.json");
  const integrityText = files.get("integrity.json");
  if (manifestText === undefined || integrityText === undefined) {
    throw new Error(`${label}: manifest.json and integrity.json are required`);
  }
  for (const [name, content] of files) {
    if (!DATA_FILE_NAMES.includes(name)) {
      throw new Error(
        `${label}: unknown or executable file is forbidden: ${name}`,
      );
    }
    if (FORBIDDEN_CONTENT.test(content)) {
      throw new Error(
        `${label}: CSS, HTML, or URL content is forbidden: ${name}`,
      );
    }
  }

  const manifest = JSON.parse(manifestText);
  const integrity = JSON.parse(integrityText);
  const manifestReport = contract.validateSkinManifest(manifest);
  if (!manifestReport.valid) {
    throw new Error(
      `${label}: manifest validation failed: ${JSON.stringify(manifestReport.issues)}`,
    );
  }
  const expectedDataFiles = [
    "manifest.json",
    ...Object.values(manifest.tokens),
  ];
  const expectedAllFiles = new Set([...expectedDataFiles, "integrity.json"]);
  if (
    files.size !== expectedAllFiles.size ||
    [...files.keys()].some((name) => !expectedAllFiles.has(name))
  ) {
    throw new Error(`${label}: exact skin data file allowlist mismatch`);
  }

  const tokenDocuments = {};
  for (const name of Object.values(manifest.tokens)) {
    const content = files.get(name);
    if (content === undefined) throw new Error(`${label}: missing ${name}`);
    tokenDocuments[name] = JSON.parse(content);
  }
  const packageReport = contract.validateSkinPackage({
    manifest,
    tokenDocuments,
  });
  if (!packageReport.valid) {
    throw new Error(
      `${label}: skin package validation failed: ${JSON.stringify(packageReport.issues)}`,
    );
  }
  const integrityReport = contract.validateSkinIntegrity(integrity, manifest);
  if (!integrityReport.valid) {
    throw new Error(
      `${label}: integrity validation failed: ${JSON.stringify(integrityReport.issues)}`,
    );
  }
  for (const name of expectedDataFiles) {
    const actualHash = sha256(files.get(name));
    if (actualHash !== integrity.files[name]) {
      throw new Error(`${label}: sha256 mismatch for ${name}`);
    }
  }
  return expectedAllFiles.size;
}

const SNAPSHOT_FIELDS = ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"];

function sameStat(left, right) {
  return SNAPSHOT_FIELDS.every((field) => left[field] === right[field]);
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
  );
}

async function readStableFile(path, expected) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error(`Skin package entry is not a regular file: ${path}`);
    }
    const content = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameStat(before, after) || BigInt(content.byteLength) !== after.size) {
      throw new Error(`Skin package file changed while being read: ${path}`);
    }
    if (
      expected !== undefined &&
      (!sameStat(after, expected.stat) || !content.equals(expected.content))
    ) {
      throw new Error(`Skin package file changed during verification: ${path}`);
    }
    const pathStat = await lstat(path, { bigint: true });
    if (pathStat.isSymbolicLink() || !sameIdentity(after, pathStat)) {
      throw new Error(`Skin package file identity changed: ${path}`);
    }
    return { content, stat: after };
  } finally {
    await handle.close();
  }
}

async function readStrictPackage(directory) {
  const directoryStat = await lstat(directory, { bigint: true });
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(
      "Skin package path must be a real directory, not a symlink",
    );
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = new Map();
  const snapshots = new Map();
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (!entry.isFile()) {
      throw new Error(
        `Skin package entries must be regular files: ${entry.name}`,
      );
    }
    const snapshot = await readStableFile(path);
    snapshots.set(entry.name, snapshot);
    files.set(entry.name, snapshot.content.toString("utf8"));
  }
  const entryNames = entries.map((entry) => entry.name).sort();
  const assertUnchanged = async () => {
    const finalDirectoryStat = await lstat(directory, { bigint: true });
    if (
      finalDirectoryStat.isSymbolicLink() ||
      !sameIdentity(directoryStat, finalDirectoryStat)
    ) {
      throw new Error("Skin package root identity changed during verification");
    }
    const finalEntries = await readdir(directory, { withFileTypes: true });
    const finalNames = finalEntries.map((entry) => entry.name).sort();
    if (JSON.stringify(finalNames) !== JSON.stringify(entryNames)) {
      throw new Error(
        "Skin package directory entries changed during verification",
      );
    }
    for (const entry of finalEntries) {
      if (!entry.isFile()) {
        throw new Error(
          `Skin package entry type changed during verification: ${entry.name}`,
        );
      }
      await readStableFile(
        join(directory, entry.name),
        snapshots.get(entry.name),
      );
    }
  };
  return { assertUnchanged, files };
}

async function bundledArtemisFiles() {
  const directory = join(root, "packages/theme-artemis/dist");
  const files = new Map();
  for (const name of DATA_FILE_NAMES) {
    files.set(name, await readFile(join(directory, name), "utf8"));
  }
  return files;
}

async function syntheticStressFiles() {
  const fixture = await import(
    pathToFileURL(join(root, "apps/ui-gallery/src/stress-skin-fixture.mjs"))
      .href
  );
  return new Map(
    Object.entries(fixture.stressSkinPackageFiles).map(([name, value]) => [
      name,
      canonicalJson(value),
    ]),
  );
}

export async function verifyExternalSkinPackage(directory, hooks = {}) {
  const snapshot = await readStrictPackage(directory);
  await hooks.afterSnapshot?.({ directory });
  const count = await verifyFileMap(
    `external fixture ${directory}`,
    snapshot.files,
  );
  await hooks.afterValidation?.({ directory });
  await snapshot.assertUnchanged();
  return count;
}

async function main() {
  const packagePath = parseCli(process.argv.slice(2));
  if (packagePath !== undefined) {
    const directory = resolve(packagePath);
    const count = await verifyExternalSkinPackage(directory);
    console.log(
      `Skin package verification passed (external; ${count} exact data files)`,
    );
    return;
  }
  const [bundledCount, stressCount] = await Promise.all([
    verifyFileMap(
      "bundled Artemis data projection",
      await bundledArtemisFiles(),
    ),
    verifyFileMap("synthetic stress skin", await syntheticStressFiles()),
  ]);
  console.log(
    `Skin package verification passed (bundled=${bundledCount}; stress=${stressCount}; CSS/JS/HTML/URL rejected)`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
