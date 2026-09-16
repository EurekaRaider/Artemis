import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../shared/ui-text.js";
import { useEffect, useRef } from "react";
import { customAgentColorToken } from "./CustomAgentMention.js";
import type { CustomAgentDraftTask } from "./composer-drafts.js";

export function CustomAgentTaskBlocks({
  tasks,
  focusTaskId,
  locale,
  onChange,
  onRemove,
}: {
  tasks: readonly CustomAgentDraftTask[];
  focusTaskId: string | undefined;
  locale: AppLocale;
  onChange(id: string, text: string): void;
  onRemove(id: string): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusTaskId) return;
    root.current
      ?.querySelector<HTMLTextAreaElement>(
        `[data-task-id="${CSS.escape(focusTaskId)}"] textarea`,
      )
      ?.focus();
  }, [focusTaskId]);
  return (
    <div className="composer-agent-tasks" ref={root}>
      {tasks.map((task) => (
        <section
          className="composer-agent-task"
          data-task-id={task.id}
          key={task.id}
        >
          <div className="composer-agent-task-heading">
            <span
              aria-hidden="true"
              className={`custom-agent-color custom-agent-color-${customAgentColorToken(task.color)}`}
            />
            <span className="composer-selected-agent-name" title={task.name}>
              @{task.name}
            </span>
            <button
              className="composer-selected-skill-remove"
              type="button"
              aria-label={uiText(locale, "CustomAgentTaskBlocks.removeNamed", {
                name: task.name,
              })}
              title={uiText(locale, "CustomAgentTaskBlocks.inline1")}
              onClick={() => onRemove(task.id)}
            >
              ×
            </button>
          </div>
          <textarea
            aria-label={uiText(locale, "CustomAgentTaskBlocks.taskFor", {
              name: task.name,
            })}
            placeholder={uiText(locale, "CustomAgentTaskBlocks.inline2")}
            value={task.text}
            onChange={(event) => onChange(task.id, event.target.value)}
          />
        </section>
      ))}
    </div>
  );
}
