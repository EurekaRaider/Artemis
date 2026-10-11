import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Credentials exist only in a private temporary keychain, restored after signing.
export async function withMacSigningKeychain(scratch, environment, action) {
  if (
    !environment.APPLE_TEAM_ID ||
    !environment.CSC_LINK ||
    !environment.CSC_KEY_PASSWORD
  )
    throw new Error("macOS signing credentials are required");
  const run = (args) => {
    try {
      return execFileSync("/usr/bin/security", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error("macOS signing keychain operation failed");
    }
  };
  const certificate = join(scratch, "certificate.p12");
  const keychain = join(scratch, "signing.keychain-db");
  const password = randomBytes(32).toString("hex");
  const previous = [
    ...run(["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/gu),
  ].map((match) => match[1]);
  await writeFile(certificate, Buffer.from(environment.CSC_LINK, "base64"), {
    mode: 0o600,
  });
  run(["create-keychain", "-p", password, keychain]);
  try {
    run(["unlock-keychain", "-p", password, keychain]);
    run(["set-keychain-settings", keychain]);
    run(["list-keychains", "-d", "user", "-s", keychain, ...previous]);
    run([
      "import",
      certificate,
      "-k",
      keychain,
      "-P",
      environment.CSC_KEY_PASSWORD,
      "-T",
      "/usr/bin/codesign",
    ]);
    run([
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      password,
      keychain,
    ]);
    const identities = run([
      "find-identity",
      "-v",
      "-p",
      "codesigning",
      keychain,
    ]);
    const identity = [...identities.matchAll(/"([^"]+)"/gu)]
      .map((match) => match[1])
      .find(
        (name) =>
          name.startsWith("Developer ID Application:") &&
          name.endsWith("(" + environment.APPLE_TEAM_ID + ")"),
      );
    if (!identity)
      throw new Error(
        "Developer ID Application identity does not match APPLE_TEAM_ID",
      );
    return await action({ identity, keychain });
  } finally {
    try {
      run(["list-keychains", "-d", "user", "-s", ...previous]);
    } finally {
      run(["delete-keychain", keychain]);
    }
  }
}
