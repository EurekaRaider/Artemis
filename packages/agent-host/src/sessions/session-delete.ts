import { realpath, rm } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

function isOutsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(relativePath)
  );
}

export async function deletePiSessionTranscript(
  sessionFile: string,
  sessionRoot: string,
): Promise<void> {
  const target = resolve(sessionFile);
  const root = resolve(sessionRoot);
  if (extname(target).toLowerCase() !== ".jsonl") {
    throw new Error("Pi session transcript must be a JSONL file.");
  }
  if (isOutsideRoot(root, target)) {
    throw new Error(
      "Pi session transcript is outside the trusted session root.",
    );
  }

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    canonicalRoot = await realpath(root);
    canonicalTarget = await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (isOutsideRoot(canonicalRoot, canonicalTarget)) {
    throw new Error(
      "Pi session transcript is outside the trusted session root.",
    );
  }
  await rm(canonicalTarget, { force: true });
}
