import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { AgentEvent } from "@artemis/protocol";

/** Live events only: replayed history must never restore an old suggestion. */
export function useComposerPrediction(
  threadId: string | undefined,
  enabled: boolean,
  blocked: boolean,
  draft = "",
) {
  const [candidate, setCandidate] = useState<{
    threadId: string;
    text: string;
  }>();
  const composing = useRef(false);
  const unavailable = blocked || (!!draft && !composing.current);
  const current = useRef({ threadId, enabled, blocked: unavailable });
  const liveTurn = useRef<string | undefined>(undefined);
  const lastSequence = useRef(-1);
  if (current.current.threadId !== threadId) {
    composing.current = false;
    lastSequence.current = -1;
  }
  if (
    current.current.threadId !== threadId ||
    !enabled ||
    (unavailable && !current.current.blocked)
  )
    liveTurn.current = undefined;
  current.current = { threadId, enabled, blocked: unavailable };
  useEffect(() => {
    setCandidate(undefined);
  }, [threadId, enabled]);

  const dismiss = useCallback(() => {
    liveTurn.current = undefined;
    setCandidate(undefined);
  }, []);
  useEffect(() => {
    if (unavailable) dismiss();
  }, [unavailable, dismiss]);
  const compositionStart = () => {
    composing.current = true;
  };
  const compositionEnd = (value: string) => {
    composing.current = false;
    if (value.length > 0) dismiss();
  };
  const changed = (value: string) => {
    if (!composing.current && value.length > 0) dismiss();
  };
  const receive = useCallback(
    (event: AgentEvent) => {
      const state = current.current;
      if (
        event.threadId !== state.threadId ||
        event.seq <= lastSequence.current
      )
        return;
      lastSequence.current = event.seq;
      if (!state.enabled) return;
      if (event.payload.type === "turn.started") {
        liveTurn.current = event.turnId;
        setCandidate(undefined);
      } else if (
        event.payload.type === "turn.failed" ||
        event.payload.type === "user-input.requested" ||
        event.payload.type === "approval.requested"
      ) {
        dismiss();
      } else if (
        event.payload.type === "turn.completed" &&
        event.turnId !== undefined &&
        liveTurn.current === event.turnId
      ) {
        liveTurn.current = undefined;
        setCandidate(
          !state.blocked &&
            event.payload.reason === "completed" &&
            event.payload.composerPrediction
            ? {
                threadId: event.threadId,
                text: event.payload.composerPrediction,
              }
            : undefined,
        );
      }
    },
    [dismiss],
  );
  const text =
    enabled &&
    !blocked &&
    !draft &&
    candidate &&
    candidate.threadId === threadId
      ? candidate.text
      : undefined;
  const keyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    accept: (text: string) => void,
  ): boolean => {
    if (
      !text ||
      composing.current ||
      event.nativeEvent.isComposing ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return false;
    if (event.key !== "Tab" && event.key !== "Escape") return false;
    event.preventDefault();
    if (event.key === "Tab") accept(text);
    dismiss();
    return true;
  };
  return {
    text,
    dismiss,
    receive,
    keyDown,
    compositionStart,
    compositionEnd,
    changed,
  };
}
