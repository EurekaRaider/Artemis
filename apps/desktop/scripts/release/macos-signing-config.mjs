import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const signingConfigPath = join(
  homedir(),
  "Library",
  "Application Support",
  "Artemis",
  "build",
  "macos-signing.json",
);

export async function loadMacSigningEnvironment(path = signingConfigPath) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  const config = JSON.parse(source);
  const keys = [
    "CSC_NAME",
    "APPLE_KEYCHAIN_PROFILE",
    "ARTEMIS_UPDATE_OWNER",
    "ARTEMIS_UPDATE_REPO",
  ];
  if (
    !config ||
    Object.keys(config).some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof config[key] !== "string" || !config[key].trim())
  ) {
    throw new Error(`Invalid macOS signing configuration: ${path}`);
  }
  return config;
}
