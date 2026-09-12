import { useEffect, useRef } from "react";
import { customAgentColorToken } from "./CustomAgentMention.js";
import type { CustomAgentDraftTask } from "./composer-drafts.js";

export function CustomAgentTaskBlocks({
  tasks,
  focusTaskId,
  zh,
  onChange,
  onRemove,
}: {
  tasks: readonly CustomAgentDraftTask[];
  focusTaskId: string | undefined;
  zh: boolean;
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
              aria-label={`${zh ? "移除任务" : "Remove task"}: ${task.name}`}
              title={zh ? "移除任务" : "Remove task"}
              onClick={() => onRemove(task.id)}
            >
              ×
            </button>
          </div>
          <textarea
            aria-label={`${zh ? "交给" : "Task for"} @${task.name}${zh ? "的任务" : ""}`}
            placeholder={
              zh
                ? "填写交给这个子智能体的任务…"
                : "Describe this sub-agent's task…"
            }
            value={task.text}
            onChange={(event) => onChange(task.id, event.target.value)}
          />
        </section>
      ))}
    </div>
  );
}
