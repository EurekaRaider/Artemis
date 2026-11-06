import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { isSkillInstallerMetadata } from "./skill-metadata.js";
import { assertNativeManifestVersion } from "../../shared/plugin-manifest.js";
import {
  exists,
  readJson,
  declaredPath,
  canonicalDirectory,
  collectFiles,
  collectedHash,
} from "./plugin-files.js";
import {
  record,
  text,
  stableValue,
  portableRelative,
} from "./plugin-values.js";
import {
  MAX_MARKETPLACE_BYTES,
  MAX_PLUGIN_FILES,
  MAX_PLUGIN_FILE_BYTES,
  MAX_PLUGIN_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_MARKETPLACE_ARCHIVE_ENTRIES,
  MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES,
  MAX_SKILL_FILES,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_BYTES,
} from "./plugin-constants.js";
import { normalizeGithubMarketplaceUrl } from "./marketplace-download.js";
import { type VerifiedMarketplaceIntegrity } from "./plugin-types.js";
export async function verifyMarketplaceIntegrity(
  root: string,
  marketplaceFilePath: string,
): Promise<VerifiedMarketplaceIntegrity | undefined> {
  const integrityPath = join(root, ".artemis", "integrity.json");
  if (!(await exists(integrityPath))) return undefined;
  const marketplaceBytes = await readFile(marketplaceFilePath);
  const marketplace = record(JSON.parse(marketplaceBytes.toString("utf8")));
  const integrity = record(
    await readJson(integrityPath, MAX_MARKETPLACE_BYTES),
  );
  const signature = text(integrity?.signature);
  const publicKeyText = text(integrity?.publicKey);
  const fingerprint = text(integrity?.signingKeyFingerprint);
  if (
    integrity?.schemaVersion !== 1 ||
    integrity.signatureAlgorithm !== "Ed25519" ||
    !signature ||
    !publicKeyText ||
    !fingerprint ||
    !/^[a-f0-9]{64}$/u.test(fingerprint) ||
    integrity.marketplaceName !== marketplace?.name ||
    integrity.marketplaceHash !==
      createHash("sha256").update(marketplaceBytes).digest("hex")
  ) {
    throw new Error("Marketplace integrity declaration is invalid.");
  }
  const publicDer = Buffer.from(publicKeyText, "base64");
  if (createHash("sha256").update(publicDer).digest("hex") !== fingerprint) {
    throw new Error("Marketplace signing key fingerprint is invalid.");
  }
  const unsigned = { ...integrity };
  delete unsigned.signature;
  let validSignature = false;
  try {
    validSignature = verifySignature(
      null,
      Buffer.from(JSON.stringify(stableValue(unsigned))),
      createPublicKey({ key: publicDer, format: "der", type: "spki" }),
      Buffer.from(signature, "base64"),
    );
  } catch {
    validSignature = false;
  }
  if (!validSignature) throw new Error("Marketplace signature is invalid.");

  let sourceUrl: string | undefined;
  const declaredSourceUrl = text(integrity.sourceUrl);
  if (declaredSourceUrl) {
    try {
      sourceUrl = normalizeGithubMarketplaceUrl(declaredSourceUrl);
    } catch {
      throw new Error("Marketplace offline source URL is invalid.");
    }
  }

  const entries = Array.isArray(marketplace?.plugins)
    ? marketplace.plugins.map(record).filter(Boolean)
    : [];
  const signedPlugins = Array.isArray(integrity.plugins)
    ? integrity.plugins.map(record).filter(Boolean)
    : [];
  if (entries.length === 0 || signedPlugins.length !== entries.length) {
    throw new Error(
      "Marketplace signed plugin list does not match its catalog.",
    );
  }
  const byName = new Map(
    signedPlugins.map((plugin) => [text(plugin?.name), plugin] as const),
  );
  const pluginHashes = new Map<string, string>();
  const packageFiles = new Set([
    ".artemis/marketplace.json",
    ".artemis/integrity.json",
  ]);
  const canonicalRoot = await realpath(root);
  for (const entry of entries) {
    const name = text(entry?.name);
    const sourceValue = entry?.source;
    const source = record(sourceValue);
    const sourcePath =
      typeof sourceValue === "string"
        ? text(sourceValue)
        : source?.source === "local"
          ? text(source.path)
          : undefined;
    const signed = name ? byName.get(name) : undefined;
    if (!name || !sourcePath || !signed) {
      throw new Error("Marketplace signed plugin entry is invalid.");
    }
    const pluginRoot = await canonicalDirectory(
      declaredPath(root, sourcePath, "Marketplace plugin"),
      root,
    );
    const pluginRelativeRoot = portableRelative(
      relative(canonicalRoot, pluginRoot),
    );
    const files = await collectFiles(pluginRoot, {
      maximumFiles: MAX_PLUGIN_FILES,
      maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
      maximumBytes: MAX_PLUGIN_BYTES,
    });
    const manifest = record(
      await readJson(
        join(pluginRoot, "artemis.plugin.json"),
        MAX_MANIFEST_BYTES,
      ),
    );
    assertNativeManifestVersion(manifest, "plugin");
    const signedFiles = Array.isArray(signed.files)
      ? signed.files.map(record).filter(Boolean)
      : [];
    const exactFiles =
      signedFiles.length === files.length &&
      files.every((file, index) => {
        const expected = signedFiles[index];
        return (
          expected?.path === file.relativePath &&
          expected.size === file.size &&
          expected.sha256 === file.hash
        );
      });
    const hash = collectedHash(files);
    if (
      signed.version !== manifest?.version ||
      signed.contentHash !== hash ||
      signed.size !== files.reduce((sum, file) => sum + file.size, 0) ||
      !exactFiles
    ) {
      throw new Error(`Marketplace content signature failed for ${name}.`);
    }
    pluginHashes.set(name, hash);
    for (const file of files) {
      packageFiles.add(`${pluginRelativeRoot}/${file.relativePath}`);
    }
  }
  return {
    signingKeyFingerprint: fingerprint,
    pluginHashes,
    packageFiles,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export async function validateOfflineMarketplacePackage(
  root: string,
  integrity: VerifiedMarketplaceIntegrity,
): Promise<void> {
  const files = await collectFiles(root, {
    maximumFiles: MAX_MARKETPLACE_ARCHIVE_ENTRIES,
    maximumFileBytes: MAX_PLUGIN_FILE_BYTES,
    maximumBytes: MAX_MARKETPLACE_ARCHIVE_UNPACKED_BYTES,
    includeGit: true,
  });
  const unexpected = files.find(
    (file) => !integrity.packageFiles.has(file.relativePath),
  );
  if (unexpected) {
    throw new Error(
      `Offline marketplace package contains an unsigned file: ${unexpected.relativePath}`,
    );
  }
  if (files.length !== integrity.packageFiles.size) {
    throw new Error("Offline marketplace package is incomplete.");
  }
}

export async function installedSkillMatchesHash(
  root: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    const files = await collectFiles(root, {
      maximumFiles: MAX_SKILL_FILES + 1,
      maximumFileBytes: MAX_SKILL_FILE_BYTES,
      maximumBytes: MAX_SKILL_BYTES,
    });
    return (
      collectedHash(
        files.filter((file) => !isSkillInstallerMetadata(file.relativePath)),
      ) === expectedHash
    );
  } catch {
    return false;
  }
}
