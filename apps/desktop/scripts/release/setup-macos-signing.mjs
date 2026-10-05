import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { signingConfigPath } from "./macos-signing-config.mjs";

if (process.platform !== "darwin") {
  throw new Error("macOS signing must be configured on macOS.");
}

const identities = execFileSync(
  "/usr/bin/security",
  ["find-identity", "-v", "-p", "codesigning"],
  { encoding: "utf8" },
);
const names = Array.from(
  identities.matchAll(/"(Developer ID Application: [^"\n]+)"/gu),
  (match) => match[1],
);
if (names.length === 0) {
  throw new Error("No valid Developer ID Application certificate was found.");
}

const input = createInterface({ input: process.stdin, output: process.stdout });
let identity;
let appleId;
try {
  names.forEach((name, index) => console.log(`${index + 1}. ${name}`));
  const index =
    names.length === 1
      ? 0
      : Number(await input.question("选择签名证书编号: ")) - 1;
  identity = names[index];
  if (!identity) throw new Error("Invalid certificate selection.");
  appleId = (await input.question("Apple 开发者账号邮箱: ")).trim();
  if (!appleId) throw new Error("Apple ID is required.");
} finally {
  input.close();
}
const teamId = identity.match(/\(([A-Z0-9]{10})\)$/u)?.[1];
if (!teamId) throw new Error("Cannot determine the certificate Team ID.");

const profile = "Artemis-notarization";
console.log(
  "接下来输入 Apple App 专用密码（输入时不显示）；密码只保存到 macOS 钥匙串。",
);
const credentials = spawnSync(
  "/usr/bin/xcrun",
  [
    "notarytool",
    "store-credentials",
    profile,
    "--apple-id",
    appleId,
    "--team-id",
    teamId,
  ],
  { stdio: "inherit" },
);
if (credentials.error) throw credentials.error;
if (credentials.status !== 0) {
  throw new Error(
    "Apple credential validation failed; configuration not saved.",
  );
}

await mkdir(dirname(signingConfigPath), { recursive: true, mode: 0o700 });
const temporaryPath = `${signingConfigPath}.${process.pid}.tmp`;
await writeFile(
  temporaryPath,
  `${JSON.stringify(
    {
      CSC_NAME: identity.replace(/^Developer ID Application: /u, ""),
      APPLE_KEYCHAIN_PROFILE: profile,
      ARTEMIS_UPDATE_OWNER: "EurekaRaider",
      ARTEMIS_UPDATE_REPO: "Artemis",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
await rename(temporaryPath, signingConfigPath);
console.log(`已保存长期配置：${signingConfigPath}`);
console.log(
  "发布一条龙：npm run release:mac:arm64；仅签名：npm run sign:mac:arm64；单独公证：npm run notarize:mac:arm64。",
);
