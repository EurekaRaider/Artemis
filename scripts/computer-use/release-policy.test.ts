import { expect, it } from "vitest";
import type { ComputerUsePackManifest } from "@artemis/protocol";
import {
  COMPUTER_USE_ACCEPTANCE_CHECKS,
  rejectCatalogRegression,
  validateNativeAcceptance,
} from "./release-policy.js";
const manifests = [
  {
    platform: "darwin",
    arch: "arm64",
    version: "1.2.0",
    sourceDigest: "e".repeat(64),
    archive: { sha256: "a".repeat(64) },
  },
  {
    platform: "win32",
    arch: "x64",
    version: "1.2.0",
    sourceDigest: "e".repeat(64),
    archive: { sha256: "b".repeat(64) },
  },
] as ComputerUsePackManifest[];
function acceptance() {
  return Object.fromEntries(
    manifests.map((manifest) => [
      manifest.platform,
      {
        archiveSha256: manifest.archive.sha256,
        packVersion: manifest.version,
        sourceDigest: manifest.sourceDigest,
        hostVersion: "1.7.6",
        arch: manifest.arch,
        checks: {
          "manifest-signature": true,
          "archive-integrity": true,
          "plugin-manifest": true,
          "native-verification": true,
        },
        effectiveAclVerified: manifest.platform === "win32",
        notarizationVerified: manifest.platform === "darwin",
      },
    ]),
  );
}
it("accepts verified Ed25519 Windows packs without a manual desktop checklist", () => {
  expect(() =>
    validateNativeAcceptance(acceptance(), manifests, "1.7.6"),
  ).not.toThrow();
});
it.each([
  ["effectiveAclVerified", false],
  ["arch", "arm64"],
  ["hostVersion", "1.7.5"],
  ["sourceDigest", "d".repeat(64)],
  ["archiveSha256", "d".repeat(64)],
  ["packVersion", "1.1.0"],
])("blocks invalid Windows package evidence %s=%s", (field, value) => {
  const evidence = acceptance();
  evidence.win32![field] = value;
  expect(() =>
    validateNativeAcceptance(evidence, manifests, "1.7.6"),
  ).toThrow();
});
it("requires each actual artifact verification on both platforms", () => {
  for (const manifest of manifests)
    for (const check of COMPUTER_USE_ACCEPTANCE_CHECKS) {
      const evidence = acceptance();
      evidence[manifest.platform]!.checks[check] = false;
      expect(() =>
        validateNativeAcceptance(evidence, manifests, "1.7.6"),
      ).toThrow();
    }
});
it("requires macOS arm64 notarization", () => {
  for (const change of [{ arch: "x64" }, { notarizationVerified: false }]) {
    const evidence = acceptance();
    Object.assign(evidence.darwin!, change);
    expect(() =>
      validateNativeAcceptance(evidence, manifests, "1.7.6"),
    ).toThrow();
  }
});
it("prevents a stable-channel downgrade and immutable replacement", () => {
  expect(() => rejectCatalogRegression(manifests, manifests)).not.toThrow();
  expect(() =>
    rejectCatalogRegression(manifests, [
      { ...manifests[0]!, version: "1.3.0" },
    ]),
  ).toThrow("backwards");
  expect(() =>
    rejectCatalogRegression(manifests, [
      {
        ...manifests[0]!,
        archive: { ...manifests[0]!.archive, sha256: "d".repeat(64) },
      },
    ]),
  ).toThrow("republished");
});
