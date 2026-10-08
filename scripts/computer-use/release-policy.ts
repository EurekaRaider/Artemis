import { gt } from "semver";
import type { ComputerUsePackManifest } from "@artemis/protocol";

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
    const result = record(record(evidence)[manifest.platform]);
    const checks = record(result.checks);
    if (
      result.archiveSha256 !== manifest.archive.sha256 ||
      result.packVersion !== manifest.version ||
      result.sourceDigest !== manifest.sourceDigest ||
      result.hostVersion !== hostVersion ||
      result.arch !== manifest.arch ||
      !COMPUTER_USE_ACCEPTANCE_CHECKS.every((check) => checks[check] === true)
    )
      throw new Error(
        "Native package verification is missing for " + manifest.platform,
      );
    if (manifest.platform === "win32" && result.effectiveAclVerified !== true)
      throw new Error(
        "Windows effective installation ACL verification is required",
      );
    if (manifest.platform === "darwin" && result.notarizationVerified !== true)
      throw new Error("Signed macOS arm64 desktop acceptance is missing");
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
