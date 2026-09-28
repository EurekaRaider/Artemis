import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const repo = "EurekaRaider/ArtemisRelease";
const tag = "office-runtime-v1.0.1";
const out = "artifacts/office/windows-release";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const api = (path) => JSON.parse(gh("api", `repos/${repo}/${path}`));
const latest = api("releases/latest").tag_name;
const notes = `# Office Runtime 1.0.1 · Windows x64

## 中文

- Windows x64 运行时正式开放在线安装；Artemis 1.6.9 中打开 Documents、Presentations 或 Spreadsheets，选择“升级 Office 功能”→“在线安装”。三个插件共用一个组件。
- 复用已通过 30/30 原生样本、44 项回归、12 项安装生命周期和最终 ACL 检查的候选 ZIP，归档字节不变。自有 Windows 程序不做 Authenticode 签名；正式 Ed25519 清单和逐文件 SHA-256 仍在安装时校验。
- 离线安装选择单个 .artemis-office 文件。原生编辑保存到工作副本，完整复杂格式保真未宣称通过。
- 本次仅新增 Windows x64；目录保留现有 macOS arm64 1.0.0。独立组件不替换主程序 Latest。

## English

- The Windows x64 runtime is available for online installation in Artemis 1.6.9: open Documents, Presentations or Spreadsheets and choose Upgrade Office features → Install online. All three plugins share one component.
- The exact retained ZIP passed 30 native samples, 44 regression checks, 12 installation lifecycle checks and final ACL inspection. Custom Windows binaries remain without Authenticode signatures; the production Ed25519 manifest and per-file SHA-256 checks remain mandatory.
- Offline installation accepts one .artemis-office file. Native edits save to working copies; full complex-format fidelity is not claimed.
- This release adds Windows x64 and preserves macOS arm64 1.0.0 in the catalog. It does not change the main application's Latest release.

Candidate source: f49232f414e5f653cfd6c1e2c4476c05cca409c6
Acceptance: https://github.com/EurekaRaider/Artemis/actions/runs/36323202452
ZIP SHA-256: 198dc7bb361ecfbca457070c20bc81ffe7ee3b7b1707c2350dfba97d7ca38f47
`;
await writeFile("artifacts/office/windows-release-notes.md", notes);
await writeFile(
  join(out, "THIRD_PARTY_NOTICES.txt"),
  "Office runtime includes LibreOffice 26.8.0 (MPL 2.0 and applicable LGPL and third-party licenses), nlohmann/json 3.12.0 (MIT), and the Artemis UNO bridge. Upstream license and notice files are preserved within runtime/. Pinned upstream sources and digests are listed in sources.json.\n",
);
const files = await readdir(out);
const checksums = [];
for (const name of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(out, name)))
    hash.update(chunk);
  checksums.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(join(out, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
let release = api("releases?per_page=100").find((r) => r.tag_name === tag);
if (!release) {
  gh(
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--title",
    "Office Runtime 1.0.1 · Windows x64",
    "--draft",
    "--latest=false",
    "--notes-file",
    "artifacts/office/windows-release-notes.md",
  );
  release = api(`releases/tags/${tag}`);
}
for (const name of await readdir(out)) {
  const bytes = await readFile(join(out, name));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const asset = release.assets.find((a) => a.name === name);
  if (asset) {
    if (asset.size !== bytes.length || asset.digest !== digest)
      throw Error(`Refusing to replace different existing asset ${name}`);
  } else {
    if (!release.draft) throw Error(`Missing immutable asset ${name}`);
    gh("release", "upload", tag, join(out, name), "--repo", repo);
  }
}
release = api(`releases/tags/${tag}`);
if (release.assets.length !== (await readdir(out)).length)
  throw Error("Unexpected public asset set");
for (const asset of release.assets) {
  const bytes = await readFile(join(out, asset.name));
  if (
    asset.state !== "uploaded" ||
    asset.size !== bytes.length ||
    asset.digest !==
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  )
    throw Error(`Uploaded bytes differ: ${asset.name}`);
}
if (release.draft)
  gh("release", "edit", tag, "--repo", repo, "--draft=false", "--latest=false");
if (api("releases/latest").tag_name !== latest)
  throw Error("Runtime release changed app Latest");
console.log(
  `Published ${tag}; verified all asset digests; app Latest remains ${latest}`,
);
