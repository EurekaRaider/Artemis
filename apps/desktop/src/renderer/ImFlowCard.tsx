import type { ReactNode } from "react";
import { ArtemisIcon, type ArtemisIconName } from "@artemis/ui/icons";

export type ImFlowTranslate = (cn: string, en: string) => string;

/**
 * One step card of the guided 消息接入 flow. The head collapses completed
 * steps to a summary line; the body carries the step's live controls. The
 * leading badge carries a per-step semantic icon (① connector, ② message,
 * ③ folder); completion adds a small check badge instead of replacing the
 * icon, so finished steps stay distinguishable at a glance.
 */
export function ImFlowCard({
  icon,
  title,
  summary,
  done,
  open,
  onToggle,
  children,
  t,
}: {
  icon: ArtemisIconName;
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
            <ArtemisIcon height={13} name={icon} width={13} />
            {done && (
              <span className="im-flow-num-check">
                <ArtemisIcon height={8} name="check" width={8} />
              </span>
            )}
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
