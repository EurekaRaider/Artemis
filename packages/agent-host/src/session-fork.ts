import { SessionManager } from "@earendil-works/pi-coding-agent";

export function forkPiSession(
  sourceSessionFile: string,
  entryId?: string,
): string {
  const source = SessionManager.open(sourceSessionFile);
  const leaf = entryId ? source.getEntry(entryId) : source.getLeafEntry();
  if (!leaf) {
    throw new Error(
      entryId
        ? `Pi session entry not found: ${entryId}`
        : "Cannot fork an empty Pi session.",
    );
  }

  const forkedSessionFile = source.createBranchedSession(leaf.id);
  if (!forkedSessionFile) {
    throw new Error("Pi did not create a persisted fork session.");
  }
  return forkedSessionFile;
}
