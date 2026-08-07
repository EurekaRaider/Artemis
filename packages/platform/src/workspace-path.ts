import { existsSync, realpathSync, type PathLike } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

function existingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return current;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

export function resolveWorkspacePath(
  workspaceRoot: PathLike,
  candidatePath: string,
): string {
  const root = realpathSync.native(workspaceRoot);
  const absoluteCandidate = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(root, candidatePath);

  if (!isWithin(root, absoluteCandidate)) {
    throw new WorkspacePathError(
      `Path is outside the workspace: ${candidatePath}`,
    );
  }

  const ancestor = realpathSync.native(existingAncestor(absoluteCandidate));
  if (!isWithin(root, ancestor)) {
    throw new WorkspacePathError(
      `Path resolves through a link outside the workspace: ${candidatePath}`,
    );
  }

  return absoluteCandidate;
}
