const platform = process.argv[2];
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

requireEnvironment("CSC_LINK");
requireEnvironment("CSC_KEY_PASSWORD");
if (platform === "win") {
  requireEnvironment("ARTEMIS_WINDOWS_PUBLISHER");
} else {
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
