import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { omitReasoningFromSession } from "../models/reasoning-persistence.js";

export function piSessionDirectory(
  workspacePath: string,
  agentDir: string,
): string {
  const resolvedWorkspace = resolve(workspacePath);
  const encodedWorkspace = `--${resolvedWorkspace
    .replace(/^[/\\]/u, "")
    .replace(/[/\\:]/gu, "-")}--`;
  return join(agentDir, "sessions", encodedWorkspace);
}

export function replayDraftSessionEntries(
  entries: SessionEntry[],
  target: SessionManager,
): void {
  const supportedTypes = new Set([
    "message",
    "thinking_level_change",
    "model_change",
    "custom",
    "custom_message",
    "session_info",
  ]);
  const unsupported = entries.find((entry) => !supportedTypes.has(entry.type));
  if (unsupported) {
    throw new Error(
      `Cannot persist a draft Pi session containing ${unsupported.type} entries.`,
    );
  }
  for (const entry of entries) {
    switch (entry.type) {
      case "message":
        target.appendMessage(entry.message as never);
        break;
      case "thinking_level_change":
        target.appendThinkingLevelChange(entry.thinkingLevel);
        break;
      case "model_change":
        target.appendModelChange(entry.provider, entry.modelId);
        break;
      case "custom":
        target.appendCustomEntry(entry.customType, entry.data);
        break;
      case "custom_message":
        target.appendCustomMessageEntry(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
        );
        break;
      case "session_info":
        target.appendSessionInfo(entry.name ?? "");
        break;
    }
  }
}

export function createLazySessionManager(
  workspacePath: string,
  agentDir: string,
  onPersist: (sessionFile: string) => void,
): SessionManager {
  let active = omitReasoningFromSession(SessionManager.inMemory(workspacePath));
  const sessionId = active.getSessionId();
  const persist = (): string => {
    if (active.isPersisted()) {
      const existing = active.getSessionFile();
      if (!existing) throw new Error("Persisted Pi session has no file.");
      return existing;
    }
    const entries = active.getEntries();
    const persisted = omitReasoningFromSession(
      SessionManager.create(
        workspacePath,
        piSessionDirectory(workspacePath, agentDir),
        { id: sessionId },
      ),
    );
    replayDraftSessionEntries(entries, persisted);
    active = persisted;
    const sessionFile = active.getSessionFile();
    if (!sessionFile) throw new Error("Pi did not create a session path.");
    return sessionFile;
  };

  return new Proxy(active, {
    get(_target, property) {
      if (property === "appendMessage") {
        return (
          message: Parameters<SessionManager["appendMessage"]>[0],
        ): string => {
          const sessionFile =
            !active.isPersisted() && message.role === "assistant"
              ? persist()
              : undefined;
          const entryId = active.appendMessage(message);
          if (sessionFile) onPersist(sessionFile);
          return entryId;
        };
      }
      const value = Reflect.get(active, property, active) as unknown;
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
}
