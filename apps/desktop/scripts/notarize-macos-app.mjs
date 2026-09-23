import { execFile } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Retry only repeatable operations. Submitting an archive is deliberately excluded:
// a lost response may still mean Apple accepted the submission.
export async function retryNotarizationOperation(operation, wait = delay) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch {
      if (attempt === 3)
        throw new Error("Notarization operation failed after 3 attempts.");
      console.log(
        `Notarization operation failed; retry ${attempt}/2 in ${attempt * 15} seconds.`,
      );
      await wait(attempt * 15000);
    }
  }
}

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

export async function notarizeExistingMacApp(
  appPath,
  version,
  environment,
  executeCommand = execute,
  wait = delay,
) {
  const execute = executeCommand;
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
    const cdhash = /^CDHash=(.+)$/m.exec(signature)?.[1];
    if (!cdhash) throw new Error("Signed app has no CDHash.");
    const statePath = join(
      dirname(dirname(appPath)),
      `notarization-${basename(dirname(appPath))}.json`,
    );
    let record;
    try {
      record = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      record?.version === version &&
      record?.cdhash === cdhash &&
      ["Invalid", "Rejected"].includes(record?.status)
    )
      throw new Error(
        `Apple rejected submission ${record.id}; inspect its log and rebuild the signed app before resubmitting.`,
      );
    let id =
      record?.version === version &&
      record?.cdhash === cdhash &&
      record?.status !== "Invalid"
        ? record.id
        : undefined;
    if (id && (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)))
      throw new Error("Saved notarization submission ID is invalid.");
    if (!id) {
      let submission;
      try {
        submission = await execute("/usr/bin/xcrun", [
          "notarytool",
          "submit",
          archive,
          ...authorization,
          "--output-format",
          "json",
        ]);
      } catch {
        // execFile errors contain command arguments, potentially including passwords.
        throw new Error(
          "Apple notarization submission failed. Check credentials and network connectivity.",
        );
      }
      id = JSON.parse(submission.stdout).id;
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
        throw new Error("Apple did not return a valid submission ID.");
      await writeFile(
        statePath,
        JSON.stringify(
          { id, version, cdhash, status: "In Progress" },
          null,
          2,
        ) + "\n",
      );
    }
    console.log(
      `Apple submission ${id}. Status: xcrun notarytool info ${id} (with your notarization credentials).`,
    );
    let result;
    try {
      result = await retryNotarizationOperation(async () => {
        let response;
        try {
          response = await execute("/usr/bin/xcrun", [
            "notarytool",
            "wait",
            id,
            ...authorization,
            "--timeout",
            "20m",
            "--output-format",
            "json",
          ]);
        } catch (error) {
          // notarytool may exit nonzero for a terminal rejection; do not retry it.
          let rejected;
          try {
            rejected = JSON.parse(error.stdout);
          } catch {}
          if (rejected?.status === "Invalid" || rejected?.status === "Rejected")
            return rejected;
          throw error;
        }
        const responseResult = JSON.parse(response.stdout);
        if (
          !["Accepted", "Invalid", "Rejected"].includes(responseResult.status)
        )
          throw new Error("Submission still pending.");
        return responseResult;
      }, wait);
    } catch {
      throw new Error(
        `Apple submission ${id} has not been confirmed. Retry notarize:mac for the same signed app to resume; inspect the submission with notarytool info/log.`,
      );
    }
    await writeFile(
      statePath,
      JSON.stringify({ id, version, cdhash, status: result.status }, null, 2) +
        "\n",
    );
    console.log(`Apple submission ${id}: ${result.status}`);
    if (result.status !== "Accepted")
      throw new Error(
        `Apple did not accept submission ${id}. Use notarytool log to inspect it.`,
      );
    await retryNotarizationOperation(
      () => execute("/usr/bin/xcrun", ["stapler", "staple", appPath]),
      wait,
    );
    await execute("/usr/bin/xcrun", ["stapler", "validate", appPath]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
