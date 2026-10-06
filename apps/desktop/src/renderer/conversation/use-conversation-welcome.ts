import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { AppLocale } from "@artemis/protocol";

import {
  readLocalDraft,
  writeLocalDraft,
} from "../workspace/workspace-autosave.js";
import {
  CONVERSATION_GREETINGS,
  chooseConversationGreeting,
  conversationWelcome,
  type ConversationGreeting,
} from "./conversation-welcome.js";

const historyKey = "artemis-conversation-welcome-v1";
const historySchema = z.object({
  protocolVersion: z.literal(1),
  recent: z.array(z.enum(CONVERSATION_GREETINGS)).min(1).max(3),
});

function nextGreeting(
  returning: boolean,
  recent: readonly ConversationGreeting[],
) {
  const timestamp = Date.now();
  const greeting = chooseConversationGreeting(timestamp, returning, recent);
  return {
    timestamp,
    greeting,
    returning,
    recent: [greeting, ...recent].slice(0, 3),
  };
}

export function useConversationWelcome(locale: AppLocale, name: string) {
  const [selection, setSelection] = useState(() => {
    const history = historySchema.safeParse(readLocalDraft(historyKey));
    return nextGreeting(
      history.success,
      history.success ? history.data.recent : [],
    );
  });
  const current = useRef(selection);
  useEffect(() => {
    // An identical write on effect replay does not consume another greeting.
    writeLocalDraft(historyKey, {
      protocolVersion: 1,
      recent: selection.recent,
    });
  }, [selection]);
  const renew = useCallback(() => {
    const previous = current.current;
    const next = nextGreeting(previous.returning, previous.recent);
    current.current = next;
    setSelection(next);
  }, []);
  return {
    welcome: conversationWelcome(
      locale,
      selection.timestamp,
      name,
      selection.greeting,
    ),
    renew,
  };
}
