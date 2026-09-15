import type { ReactNode } from "react";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  ChatCircleDotsIcon,
  FolderIcon,
  PlugIcon,
} from "@phosphor-icons/react";

const stepIcons = {
  connector: PlugIcon,
  message: ChatCircleDotsIcon,
  folder: FolderIcon,
};

export type ImFlowTranslate = (cn: string, en: string) => string;

/**
 * One step card of the guided 消息接入 flow. The head collapses completed
 * steps to a summary line; the body carries the step's live controls. The
 * leading badge carries a per-step semantic icon (① connector, ② message,
 * ③ folder); a separate completion check follows the title so the colored
 * icons stay unobstructed and distinguishable at a glance.
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
  icon: keyof typeof stepIcons;
  title: string;
  summary?: ReactNode;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  t: ImFlowTranslate;
}) {
  const StepIcon = stepIcons[icon];
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
          <span aria-hidden="true" className="im-flow-num" data-icon={icon}>
            <StepIcon size={16} weight="fill" />
          </span>
          <span className="im-flow-title">
            {title}
            {done && (
              <span aria-hidden="true" className="im-flow-num-check">
                <ArtemisIcon height={8} name="check" width={8} />
              </span>
            )}
          </span>
          {summary ? <span className="im-flow-summary">{summary}</span> : null}
          <span aria-hidden="true" className="im-flow-caret">
            <ArtemisIcon name="chevron" width={16} height={16} />
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
