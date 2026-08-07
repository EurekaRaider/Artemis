import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

function existingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function canonicalizeFileSystemPath(path: string): string {
  const absolute = resolve(path);
  const ancestor = existingAncestor(absolute);
  const canonicalAncestor = realpathSync.native(ancestor);
  return resolve(canonicalAncestor, relative(ancestor, absolute));
}

export function sameFileSystemPath(left: string, right: string): boolean {
  const canonicalLeft = canonicalizeFileSystemPath(left);
  const canonicalRight = canonicalizeFileSystemPath(right);
  return process.platform === "win32"
    ? canonicalLeft.toLowerCase() === canonicalRight.toLowerCase()
    : canonicalLeft === canonicalRight;
}
