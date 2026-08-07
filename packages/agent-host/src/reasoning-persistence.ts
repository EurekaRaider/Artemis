import { SessionManager } from "@earendil-works/pi-coding-agent";

type PersistedMessage = Parameters<SessionManager["appendMessage"]>[0];

export function withoutPersistedReasoning(
  message: PersistedMessage,
): PersistedMessage {
  if (message.role !== "assistant") return message;
  const content = message.content.filter((part) => part.type !== "thinking");
  return content.length === message.content.length
    ? message
    : { ...message, content };
}

export function omitReasoningFromSession(
  sessionManager: SessionManager,
): SessionManager {
  const appendMessage = sessionManager.appendMessage.bind(sessionManager);
  sessionManager.appendMessage = (message) =>
    appendMessage(withoutPersistedReasoning(message));
  return sessionManager;
}
