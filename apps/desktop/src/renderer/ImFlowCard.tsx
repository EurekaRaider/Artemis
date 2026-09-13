import type { ReactNode } from "react";
import { ArtemisIcon } from "@artemis/ui/icons";

export type ImFlowTranslate = (cn: string, en: string) => string;

/**
 * One step card of the guided 消息接入 flow. The head collapses completed
 * steps to a summary line; the body carries the step's live controls.
 */
export function ImFlowCard({
  num,
  title,
  summary,
  done,
  open,
  onToggle,
  children,
  t,
}: {
  num: number;
  title: string;
  summary?: ReactNode;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  t: ImFlowTranslate;
}) {
  return (
    <section
      className="im-flow-card"
      data-done={done || undefined}
      data-open={open || undefined}
    >
      <h3 className="im-flow-head-h">
        <button
          type="button"
          className="im-flow-head"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span aria-hidden="true" className="im-flow-num">
            {done ? <ArtemisIcon height={12} name="check" width={12} /> : num}
          </span>
          <span className="im-flow-title">{title}</span>
          {summary ? <span className="im-flow-summary">{summary}</span> : null}
          <span aria-hidden="true" className="im-flow-caret">
            {open ? "▾" : "▸"}
          </span>
        </button>
      </h3>
      {open ? <div className="im-flow-body">{children}</div> : null}
    </section>
  );
}

export function ImFlowProgress({
  done,
  total,
  t,
}: {
  done: number;
  total: number;
  t: ImFlowTranslate;
}) {
  return (
    <span className="im-status-pill im-flow-progress" role="status">
      {t("设置进度", "Setup progress")} {done}/{total}
    </span>
  );
}
