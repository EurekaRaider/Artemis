import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyUpdateIndex } from "../../apps/desktop/src/main/updates/signed-update-index.ts";
const repository = "EurekaRaider/ArtemisRelease";
const tag = "windows-x64-stable";
const filename = "windows-x64-update.json";
const input = process.argv[2];
if (!input) throw new Error("Provide verified release asset directory");
const keys = JSON.parse(
  await readFile(
    new URL(
      "../../apps/desktop/resources/update-public-keys.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const bytes = await readFile(join(input, filename));
const next = verifyUpdateIndex(bytes, keys);
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
// The immutable version release must already be public before moving the channel.
const release = JSON.parse(
  gh("api", `repos/${repository}/releases/tags/v${next.version}`),
);
if (release.draft) throw new Error("Version release is not public");
for (const asset of next.assets) {
  const uploaded = release.assets.find((item) => item.name === asset.name);
  if (
    !uploaded ||
    uploaded.size !== asset.size ||
    uploaded.digest !== `sha256:${asset.sha256}`
  )
    throw new Error(
      `Published artifact does not match signed index: ${asset.name}`,
    );
}
const directory = await mkdtemp(join(tmpdir(), "artemis-update-channel-"));
try {
  // A 404 is distinct from permission/network errors: never reset a channel after a failed read.
  const releases = JSON.parse(
    gh("api", `repos/${repository}/releases?per_page=100`),
  );
  if (releases.some((item) => item.tag_name === tag)) {
    gh(
      "release",
      "download",
      tag,
      "--repo",
      repository,
      "--pattern",
      filename,
      "--dir",
      directory,
    );
    const previous = verifyUpdateIndex(
      await readFile(join(directory, filename)),
      keys,
    );
    if (
      next.sequence < previous.sequence ||
      (next.sequence === previous.sequence && next.version !== previous.version)
    )
      throw new Error("Refusing update channel replay or sequence reuse");
  } else {
    gh(
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--title",
      "Windows x64 update channel",
      "--notes",
      "Signed Windows x64 update index. Download installers from the version releases.",
      "--latest=false",
    );
  }
  gh(
    "release",
    "upload",
    tag,
    join(input, filename),
    "--repo",
    repository,
    "--clobber",
  );
  await rm(join(directory, filename), { force: true });
  gh(
    "release",
    "download",
    tag,
    "--repo",
    repository,
    "--pattern",
    filename,
    "--dir",
    directory,
  );
  if (!bytes.equals(await readFile(join(directory, filename))))
    throw new Error("Published channel readback mismatch");
  console.log(
    `Windows x64 channel verified: ${next.version}, sequence ${next.sequence}`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
