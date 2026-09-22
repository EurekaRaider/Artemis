import { mkdir, writeFile, rename } from "node:fs/promises";
import {
  downloadSlackAsset,
  fetchLatestSlackRelease,
  fetchSlackBytes,
  sha256,
  slackBinaryIdentity,
  slackCliLockPath,
  slackReleaseAssets,
} from "./slack-cli-release.mjs";
import { unpackSlackAsset } from "./slack-cli-package.mjs";

const release = await fetchLatestSlackRelease();
const targets = slackReleaseAssets(release);
for (const [target, asset] of Object.entries(targets)) {
  await unpackSlackAsset(
    asset,
    await downloadSlackAsset(asset),
    async (_file, bytes) => {
      const identity = slackBinaryIdentity(bytes);
      if (identity.target !== target)
        throw new Error(
          `Official Slack CLI asset has the wrong architecture: ${target}`,
        );
      Object.assign(asset, {
        binaryBytes: bytes.length,
        binarySha256: sha256(bytes),
        contentSha256: identity.contentSha256,
      });
    },
  );
}
const license = await fetchSlackBytes(
  `https://raw.githubusercontent.com/slackapi/slack-cli/${release.tag_name}/LICENSE`,
);
const latest = await fetchLatestSlackRelease();
if (latest.id !== release.id)
  throw new Error("Slack CLI changed during update; rerun the updater.");
const lock = {
  schemaVersion: 1,
  repository: "slackapi/slack-cli",
  version: release.tag_name.slice(1),
  releaseId: release.id,
  licenseSha256: sha256(license),
  targets,
};
await mkdir(new URL("../third-party/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../third-party/slack-cli-LICENSE.txt", import.meta.url),
  license,
);
const temporary = new URL("../slack-cli.lock.json.tmp", import.meta.url);
await writeFile(temporary, JSON.stringify(lock, null, 2) + "\n");
await rename(temporary, slackCliLockPath);
console.log(
  `Locked Slack CLI ${release.tag_name}. Review the diff, validate login/deploy and all three native packages before release.`,
);
