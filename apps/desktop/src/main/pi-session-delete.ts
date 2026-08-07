import { realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

function isOutsideRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  );
}

export function piSessionsRoot(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): string {
  const configured = environment.PI_CODING_AGENT_DIR?.trim();
  const agentDirectory = configured
    ? configured === "~"
      ? homeDirectory
      : configured.startsWith(`~${sep}`) ||
          configured.startsWith("~/") ||
          configured.startsWith("~\\")
        ? resolve(homeDirectory, configured.slice(2))
        : resolve(configured)
    : join(homeDirectory, ".pi", "agent");
  return join(agentDirectory, "sessions");
}

export async function deletePiSessionTranscript(
  sessionFile: string,
  sessionRoot: string,
): Promise<void> {
  const root = resolve(sessionRoot);
  const target = resolve(sessionFile);
  if (
    extname(target).toLowerCase() !== ".jsonl" ||
    isOutsideRoot(root, target)
  ) {
    throw new Error("Pi session transcript path is outside the trusted root.");
  }

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    [canonicalRoot, canonicalTarget] = await Promise.all([
      realpath(root),
      realpath(target),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (isOutsideRoot(canonicalRoot, canonicalTarget)) {
    throw new Error("Pi session transcript resolves outside the trusted root.");
  }
  await rm(canonicalTarget, { force: true });
}
