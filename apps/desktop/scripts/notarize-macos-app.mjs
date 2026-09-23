import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function notarizationArguments(environment) {
  if (environment.APPLE_ID || environment.APPLE_APP_SPECIFIC_PASSWORD) {
    if (
      !environment.APPLE_ID ||
      !environment.APPLE_APP_SPECIFIC_PASSWORD ||
      !environment.APPLE_TEAM_ID
    ) {
      throw new Error("Incomplete Apple ID notarization credentials.");
    }
    return [
      "--apple-id",
      environment.APPLE_ID,
      "--password",
      environment.APPLE_APP_SPECIFIC_PASSWORD,
      "--team-id",
      environment.APPLE_TEAM_ID,
    ];
  }
  if (!environment.APPLE_KEYCHAIN_PROFILE)
    throw new Error("Missing notarization keychain profile.");
  return [
    "--keychain-profile",
    environment.APPLE_KEYCHAIN_PROFILE,
    ...(environment.APPLE_KEYCHAIN
      ? ["--keychain", environment.APPLE_KEYCHAIN]
      : []),
  ];
}

export async function notarizeExistingMacApp(appPath, version, environment) {
  await execute("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    appPath,
  ]);
  const { stderr: signature } = await execute("/usr/bin/codesign", [
    "-dv",
    "--verbose=4",
    appPath,
  ]);
  if (!signature.includes("Authority=Developer ID Application:")) {
    throw new Error(
      "The existing app must be Developer ID signed before notarization.",
    );
  }
  const { stdout: appVersion } = await execute("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    join(appPath, "Contents", "Info.plist"),
  ]);
  if (appVersion.trim() !== version) {
    throw new Error(
      `Existing app version ${appVersion.trim()} does not match ${version}; rebuild the signed app first.`,
    );
  }
  const authorization = notarizationArguments(environment);
  const directory = await mkdtemp(join(tmpdir(), "artemis-notarization-"));
  try {
    const archive = join(directory, "Artemis.zip");
    await execute("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      appPath,
      archive,
    ]);
    console.log(`Submitting ${appPath} to Apple. Waiting for notarization...`);
    let stdout;
    try {
      ({ stdout } = await execute("/usr/bin/xcrun", [
        "notarytool",
        "submit",
        archive,
        ...authorization,
        "--wait",
        "--output-format",
        "json",
      ]));
    } catch {
      // execFile errors include their command line, which may contain a password.
      throw new Error(
        "Apple notarization submission failed. Check credentials and network connectivity.",
      );
    }
    const result = JSON.parse(stdout);
    console.log(`Apple submission ${result.id}: ${result.status}`);
    if (result.status !== "Accepted") {
      throw new Error(
        `Apple did not accept submission ${result.id}. Use notarytool log to inspect it.`,
      );
    }
    await execute("/usr/bin/xcrun", ["stapler", "staple", appPath]);
    await execute("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
