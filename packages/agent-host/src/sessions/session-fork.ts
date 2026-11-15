import { withoutComposerPredictions } from "../context/composer-prediction.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export function forkPiSession(
  sourceSessionFile: string,
  entryId?: string,
  assistantText?: string,
): string {
  const source = SessionManager.open(sourceSessionFile);
  const branch = source.getBranch();
  const messages = branch.flatMap((entry) =>
    entry.type === "message" &&
    (entry.message.role === "user" || entry.message.role === "assistant")
      ? [{ id: entry.id, message: entry.message }]
      : [],
  );
  const visibleMessages = withoutComposerPredictions(
    messages.map((entry) => entry.message),
  );
  const visibleText = new Map(
    messages.map((entry, index) => {
      const content = visibleMessages[index]!.content;
      return [
        entry.id,
        typeof content === "string"
          ? content
          : content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join(""),
      ];
    }),
  );
  const candidates =
    assistantText === undefined
      ? []
      : branch.filter(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            ["stop", "length"].includes(entry.message.stopReason) &&
            !entry.message.content.some((part) => part.type === "toolCall") &&
            visibleText.get(entry.id) === assistantText,
        );
  if (!entryId && assistantText !== undefined && candidates.length !== 1)
    throw new Error(
      "This historical reply cannot be matched uniquely to its saved session.",
    );
  const leaf = entryId
    ? source.getEntry(entryId)
    : assistantText !== undefined
      ? candidates[0]
      : source.getLeafEntry();
  if (
    assistantText !== undefined &&
    leaf &&
    (!branch.some((entry) => entry.id === leaf.id) ||
      leaf.type !== "message" ||
      leaf.message.role !== "assistant" ||
      !["stop", "length"].includes(leaf.message.stopReason) ||
      leaf.message.content.some((part) => part.type === "toolCall"))
  )
    throw new Error(
      "Historical forks require a completed assistant reply on the active branch.",
    );
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
