/**
 * Structured @ mention for custom sub-agents in the composer (D#152 PR4).
 * Mirrors the IM member-mention interaction (cursor-tracked @query,
 * listbox keyboard navigation, Escape dismissal) but selection produces a
 * draft reference chip instead of text: the @query fragment is removed and
 * the definition rides the draft until send. At most one reference per
 * message — the menu stays closed while a chip is attached.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Button } from "@artemis/ui/actions";

import type { CustomAgentSummary } from "../shared/api.js";
import type { CustomAgentDraftReference } from "./composer-drafts.js";

const COLOR_TOKENS = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type CustomAgentColorToken = (typeof COLOR_TOKENS)[number];

const COLOR_TOKEN_SET: ReadonlySet<string> = new Set(COLOR_TOKENS);

/** Controlled color token for a chip dot; unknown values fall back to gray. */
export function customAgentColorToken(color: string): CustomAgentColorToken {
  return COLOR_TOKEN_SET.has(color)
    ? (color as CustomAgentColorToken)
    : "gray";
}

/** A definition is a candidate when enabled and effective for the project. */
export function customAgentEffectiveForProject(
  summary: CustomAgentSummary,
  projectId: string | undefined,
): boolean {
  return (
    summary.enabled &&
    (summary.scope === "all" ||
      (projectId !== undefined && summary.projectIds.includes(projectId)))
  );
}

const MENTION_QUERY = /(?:^|[\s，。；：、(（])@([^@\n]*)$/u;

export function useCustomAgentMention({
  definitions,
  projectId,
  text,
  setText,
  input,
  enabled,
  onSelect,
}: {
  definitions: readonly CustomAgentSummary[];
  projectId: string | undefined;
  text: string;
  setText(text: string): void;
  input: RefObject<HTMLTextAreaElement | null>;
  /** False while a chip is attached or an IM group member menu owns @. */
  enabled: boolean;
  onSelect(reference: CustomAgentDraftReference): void;
}) {
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCursor.current;
    if (position === null) return;
    pendingCursor.current = null;
    input.current?.focus();
    input.current?.setSelectionRange(position, position);
  }, [text, input]);
  const match = text.slice(0, cursor).match(MENTION_QUERY);
  const query = match?.[1];
  const candidates =
    query === undefined
      ? []
      : definitions
          .filter((definition) =>
            customAgentEffectiveForProject(definition, projectId),
          )
          .filter((definition) => {
            if (!query) return true;
            const needle = query.toLocaleLowerCase();
            return (
              definition.name.toLocaleLowerCase().includes(needle) ||
              definition.description.toLocaleLowerCase().includes(needle) ||
              definition.triggers.some((trigger) =>
                trigger.toLocaleLowerCase().includes(needle),
              )
            );
          });
  const open =
    enabled && !dismissed && query !== undefined && candidates.length > 0;
  const activeIndex = Math.min(active, Math.max(0, candidates.length - 1));
  useEffect(() => {
    setActive(0);
  }, [query, projectId]);
  const select = (definition: CustomAgentSummary) => {
    const element = input.current;
    const end = element?.selectionEnd ?? text.length;
    // Remove the @query fragment the user typed; the reference is carried
    // by the draft, never by prompt text.
    const start = query !== undefined ? cursor - query.length - 1 : cursor;
    pendingCursor.current = start;
    setText(`${text.slice(0, start)}${text.slice(end)}`);
    setDismissed(true);
    onSelect({
      definitionId: definition.id,
      revision: definition.revision,
      name: definition.name,
      color: definition.color,
    });
  };
  return {
    open,
    candidates,
    activeIndex,
    select,
    changed(position: number) {
      setCursor(position);
      setDismissed(false);
    },
    selected(position: number) {
      setCursor(position);
    },
    keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
      if (!open || event.nativeEvent.isComposing) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive(
          (activeIndex +
            (event.key === "ArrowDown" ? 1 : candidates.length - 1)) %
            candidates.length,
        );
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        const candidate = candidates[activeIndex];
        if (candidate) select(candidate);
        return true;
      }
      return false;
    },
  };
}

export function CustomAgentMentionMenu({
  mention,
  zh,
}: {
  mention: ReturnType<typeof useCustomAgentMention>;
  zh: boolean;
}) {
  if (!mention.open) return null;
  return (
    <div
      aria-label={zh ? "选择自定义子智能体" : "Choose a custom sub-agent"}
      className="slash-command-menu custom-agent-mention-menu"
      id="custom-agent-mention-menu"
      role="listbox"
    >
      <div className="slash-command-heading">
        {zh ? "@ 子智能体 · 绑定到这条消息" : "@ Sub-agent · bind to this message"}
      </div>
      {mention.candidates.map((definition, index) => (
        <div
          aria-selected={index === mention.activeIndex}
          id={`custom-agent-mention-${index}`}
          key={definition.id}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
        >
          <Button
            className={`slash-command-suggestion${index === mention.activeIndex ? " active" : ""}`}
            onClick={() => mention.select(definition)}
            variant="quiet"
          >
            <span
              aria-hidden="true"
              className={`custom-agent-color custom-agent-color-${customAgentColorToken(definition.color)}`}
            />
            <span>
              <strong>{definition.name}</strong>
              <small title={definition.description}>
                {definition.description}
              </small>
            </span>
          </Button>
        </div>
      ))}
    </div>
  );
}
