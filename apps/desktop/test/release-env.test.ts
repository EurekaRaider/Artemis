import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../scripts/validate-release-env.mjs", import.meta.url),
);

function validate(
  platform: string,
  environment: Record<string, string>,
  extra: string[] = [],
) {
  return spawnSync(process.execPath, [script, platform, ...extra], {
    env: environment,
    encoding: "utf8",
  });
}

const feed = {
  ARTEMIS_UPDATE_OWNER: "example",
  ARTEMIS_UPDATE_REPO: "releases",
};
const localMac = {
  ...feed,
  CSC_NAME: "Developer ID Application: Example (TEAMID)",
  APPLE_KEYCHAIN_PROFILE: "example-notary",
};

describe("release environment validation", () => {
  it("allows signing without notarization credentials only in sign-only mode", () => {
    const signing = { ...feed, CSC_NAME: localMac.CSC_NAME };
    expect(validate("mac", signing, ["--sign-only"]).status).toBe(0);
    expect(validate("mac", signing).status).not.toBe(0);
    expect(validate("win", signing, ["--sign-only"]).status).not.toBe(0);
  });
  it("accepts an explicit keychain identity and notarization profile", () => {
    expect(validate("mac", localMac).status).toBe(0);
  });

  it("still accepts the CI certificate and Apple ID credentials", () => {
    expect(
      validate("mac", {
        ...feed,
        CSC_LINK: "/example/certificate.p12",
        CSC_KEY_PASSWORD: "example",
        APPLE_ID: "example@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "example",
        APPLE_TEAM_ID: "TEAMID",
      }).status,
    ).toBe(0);
  });

  it.each(["CSC_NAME", "APPLE_KEYCHAIN_PROFILE"])(
    "rejects missing local credential %s",
    (name) => {
      expect(validate("mac", { ...localMac, [name]: "" }).status).not.toBe(0);
    },
  );

  it("rejects an incomplete Apple ID configuration even with a profile", () => {
    expect(
      validate("mac", { ...localMac, APPLE_ID: "example@example.com" }).status,
    ).not.toBe(0);
  });

  it("requires the password when an imported certificate is selected", () => {
    expect(
      validate("mac", { ...localMac, CSC_LINK: "/example/certificate.p12" })
        .status,
    ).not.toBe(0);
  });

  it("does not allow local macOS credentials to bypass Windows signing", () => {
    expect(validate("win", localMac).status).not.toBe(0);
  });

  it("still rejects an insecure update feed", () => {
    expect(
      validate("mac", {
        ...localMac,
        ARTEMIS_UPDATE_URL: "http://example.com/updates",
      }).status,
    ).not.toBe(0);
  });
});
