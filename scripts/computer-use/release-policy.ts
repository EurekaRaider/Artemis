import { gt } from "semver";
import type { ComputerUsePackManifest } from "@artemis/protocol";

export const COMPUTER_USE_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
] as const;

/** Older hosts reject unknown native targets before filtering for their CPU. */
export function catalogForExistingHosts(manifests: ComputerUsePackManifest[]) {
  const intelMac = (manifest: ComputerUsePackManifest) =>
    manifest.platform === "darwin" && manifest.arch === "x64";
  return {
    manifests: manifests.filter((manifest) => !intelMac(manifest)),
    additionalManifests: manifests.filter(intelMac),
  };
}

type Release = Pick<
  ComputerUsePackManifest,
  "platform" | "arch" | "version" | "archive" | "sourceDigest"
>;
export const COMPUTER_USE_ACCEPTANCE_CHECKS = [
  "manifest-signature",
  "archive-integrity",
  "plugin-manifest",
  "native-verification",
] as const;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function validateNativeAcceptance(
  evidence: unknown,
  manifests: Release[],
  hostVersion: string,
): void {
  for (const manifest of manifests) {
    const target = manifest.platform + "-" + manifest.arch;
    const result = record(record(evidence)[target]);
    const checks = record(result.checks);
    if (
      result.archiveSha256 !== manifest.archive.sha256 ||
      result.packVersion !== manifest.version ||
      result.sourceDigest !== manifest.sourceDigest ||
      result.hostVersion !== hostVersion ||
      result.arch !== manifest.arch ||
      !COMPUTER_USE_ACCEPTANCE_CHECKS.every((check) => checks[check] === true)
    )
      throw new Error("Native package verification is missing for " + target);
    if (manifest.platform === "win32" && result.effectiveAclVerified !== true)
      throw new Error(
        "Windows effective installation ACL verification is required",
      );
    if (manifest.platform === "darwin" && result.notarizationVerified !== true)
      throw new Error(
        "Signed macOS " + manifest.arch + " desktop acceptance is missing",
      );
  }
}
export function rejectCatalogRegression(
  next: Release[],
  previous: Release[],
): void {
  for (const older of previous) {
    const current = next.find(
      (entry) => entry.platform === older.platform && entry.arch === older.arch,
    );
    if (!current || gt(older.version, current.version))
      throw new Error("Computer Use stable catalog cannot move backwards");
    if (
      current.version === older.version &&
      current.archive.sha256 !== older.archive.sha256
    )
      throw new Error(
        "An immutable Computer Use version cannot be republished",
      );
  }
}
