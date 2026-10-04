const platform = process.argv[2];
const signOnly = platform === "mac" && process.argv[3] === "--sign-only";
if (process.argv.slice(3).length && (!signOnly || process.argv.length !== 4)) {
  throw new Error("Only mac supports --sign-only.");
}
if (platform !== "win" && platform !== "mac") {
  throw new Error("Usage: validate-release-env.mjs <win|mac>");
}

const missing = [];
const requireEnvironment = (name) => {
  if (!process.env[name]?.trim()) missing.push(name);
};

if (platform === "mac") {
  if (process.env.ARTEMIS_UPDATE_URL) {
    const url = new URL(process.env.ARTEMIS_UPDATE_URL);
    if (url.protocol !== "https:") {
      throw new Error("ARTEMIS_UPDATE_URL must use HTTPS");
    }
  } else {
    requireEnvironment("ARTEMIS_UPDATE_OWNER");
    requireEnvironment("ARTEMIS_UPDATE_REPO");
  }
}

if (platform === "win" || process.env.CSC_LINK?.trim()) {
  requireEnvironment("CSC_LINK");
  requireEnvironment("CSC_KEY_PASSWORD");
} else {
  requireEnvironment("CSC_NAME");
}
if (platform === "win") {
  requireEnvironment("ARTEMIS_WINDOWS_PUBLISHER");
} else if (
  !signOnly &&
  (process.env.APPLE_ID?.trim() ||
    process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim() ||
    !process.env.APPLE_KEYCHAIN_PROFILE?.trim())
) {
  requireEnvironment("APPLE_ID");
  requireEnvironment("APPLE_APP_SPECIFIC_PASSWORD");
  requireEnvironment("APPLE_TEAM_ID");
}

if (missing.length > 0) {
  throw new Error(
    `Signed ${platform} release is blocked; missing environment variables: ${missing.join(", ")}`,
  );
}

console.log(`Signed ${platform} release environment is complete.`);
