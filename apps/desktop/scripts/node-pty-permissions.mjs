import { chmod } from "node:fs/promises";
import { join } from "node:path";

const darwinArchitectures = ["arm64", "x64"];

export async function ensureNodePtySpawnHelpersExecutable(nodePtyRoot) {
  const updated = [];

  for (const architecture of darwinArchitectures) {
    const helperPath = join(
      nodePtyRoot,
      "prebuilds",
      `darwin-${architecture}`,
      "spawn-helper",
    );
    try {
      await chmod(helperPath, 0o755);
      updated.push(helperPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }

  if (updated.length === 0) {
    throw new Error(`node-pty spawn-helper was not found under ${nodePtyRoot}`);
  }

  return updated;
}
