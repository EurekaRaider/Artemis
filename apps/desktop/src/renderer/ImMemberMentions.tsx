import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { imGroupMentionTargets, type ImGroupContext } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

export function useImMemberMentions({
  group,
  text,
  setText,
  input,
}: {
  group: ImGroupContext | undefined;
  text: string;
  setText(text: string): void;
  input: RefObject<HTMLTextAreaElement | null>;
}) {
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const members = group
    ? imGroupMentionTargets(group).filter((m) => m.state !== "unavailable")
    : [];
  const match = text
    .slice(0, cursor)
    .match(/(?:^|[\s，。；：、(（])@([^@\n]*)$/u);
  const query = match?.[1];
  const candidates =
    query === undefined
      ? []
      : members.filter((m) =>
          `${m.name} ${m.deviceName} ${m.token}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        );
  const open = !dismissed && candidates.length > 0 && !!group?.confirmed;
  const activeIndex = Math.min(active, Math.max(0, candidates.length - 1));
  useEffect(() => {
    setActive(0);
  }, [query, group?.spaceId]);
  const insert = (token: string) => {
    const element = input.current;
    const end = element?.selectionEnd ?? text.length;
    const start =
      open && query !== undefined
        ? cursor - query.length - 1
        : (element?.selectionStart ?? text.length);
    const prefix = text.slice(0, start);
    const inserted = `${prefix && !/[\s，。；：、(（]$/u.test(prefix) ? " " : ""}${token} `;
    setText(`${prefix}${inserted}${text.slice(end)}`);
    setDismissed(true);
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(
        start + inserted.length,
        start + inserted.length,
      );
    });
  };
  return {
    open,
    candidates,
    activeIndex,
    insert,
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
        insert(candidates[activeIndex]!.token);
        return true;
      }
      return false;
    },
  };
}

export function ImMemberMentionMenu({
  mentions,
  zh,
}: {
  mentions: ReturnType<typeof useImMemberMentions>;
  zh: boolean;
}) {
  if (!mentions.open) return null;
  return (
    <div
      className="slash-command-menu im-member-mention-menu"
      id="im-member-mention-menu"
      role="listbox"
      aria-label={zh ? "选择协作成员" : "Choose a collaboration member"}
    >
      <div className="slash-command-heading">
        {zh ? "@ 成员 · 选择执行任务的电脑" : "@ Member · choose a computer"}
      </div>
      {mentions.candidates.map((member, index) => (
        <div
          key={member.deviceId}
          id={`im-member-mention-${index}`}
          role="option"
          aria-selected={index === mentions.activeIndex}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button
            className={`slash-command-suggestion${index === mentions.activeIndex ? " active" : ""}`}
            variant="quiet"
            onClick={() => mentions.insert(member.token)}
          >
            <span>
              <strong>{member.name}</strong>
              <small> · {member.deviceName}</small>
            </span>
          </Button>
        </div>
      ))}
    </div>
  );
}
