// Match the hosted runner's cache compression without installing machine-wide tools.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

if (
  process.platform !== "win32" ||
  !process.env.RUNNER_TEMP ||
  !process.env.GITHUB_PATH
)
  throw new Error("A Windows Actions runner is required");

const git = execFileSync("where.exe", ["git.exe"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/u)[0];
const gitTools = join(dirname(dirname(git)), "usr", "bin");
const tar = join(gitTools, "tar.exe");
if (!execFileSync(tar, ["--version"], { encoding: "utf8" }).includes("GNU tar"))
  throw new Error("Git for Windows GNU tar is required");

const response = await fetch(
  "https://github.com/facebook/zstd/releases/download/v1.5.7/zstd-v1.5.7-win64.zip",
  { signal: AbortSignal.timeout(120_000) },
);
if (!response.ok) throw new Error(`zstd download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (
  createHash("sha256").update(bytes).digest("hex") !==
  "acb4e8111511749dc7a3ebedca9b04190e37a17afeb73f55d4425dbf0b90fad9"
)
  throw new Error("zstd archive digest mismatch");

const directory = await mkdtemp(join(process.env.RUNNER_TEMP, "office-cache-"));
const archive = join(directory, "zstd.zip");
await writeFile(archive, bytes);
// Windows' bundled bsdtar extracts ZIP; Git's GNU tar then restores the cache.
execFileSync(join(process.env.SystemRoot, "System32", "tar.exe"), [
  "-xf",
  archive,
  "-C",
  directory,
]);
const zstdTools = join(directory, "zstd-v1.5.7-win64");
execFileSync(join(zstdTools, "zstd.exe"), ["--quiet", "--version"], {
  stdio: "inherit",
});
await appendFile(process.env.GITHUB_PATH, `${gitTools}\n${zstdTools}\n`);
console.log("Verified GNU tar and temporary zstd for the hosted Windows cache");
