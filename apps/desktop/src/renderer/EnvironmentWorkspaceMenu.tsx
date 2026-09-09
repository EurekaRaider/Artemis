import { WorktreeManager } from "./WorktreeManager.js";
import { useId, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Popover } from "@artemis/ui/feedback";
import {
  EnvironmentCheckIcon,
  EnvironmentChevronIcon,
  EnvironmentLocalIcon,
  EnvironmentBranchIcon,
} from "./EnvironmentPanelIcons.js";

export function EnvironmentWorkspaceMenu({
  locale,
  path,
  worktree = false,
  disabled,
  onHandoff,
  onMessage,
  onOpenUsage,
  onWorktreesChanged,
}: {
  locale: AppLocale;
  path: string;
  worktree?: boolean | undefined;
  disabled: boolean;
  onHandoff?:
    ((destination: "local" | "managed-worktree") => Promise<void>) | undefined;
  onMessage: (message: string, error?: boolean) => void;
  onWorktreesChanged?: (() => Promise<void>) | undefined;
  onOpenUsage?: (() => void) | undefined;
}) {
  const t = (cn: string, en: string) => (locale.startsWith("zh") ? cn : en);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [managerOpen, setManagerOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const label = worktree
    ? t("本地工作树", "Local worktree")
    : t("本地", "Local");
  const change = async (destination: "local" | "managed-worktree") => {
    if (!onHandoff || disabled || pending) return;
    setPending(true);
    try {
      await onHandoff(destination);
      setOpen(false);
      onMessage(
        destination === "local"
          ? t("已继续至本地工作区", "Continued in Local")
          : t("已继续至新建本地工作树", "Continued in a new local worktree"),
      );
    } catch (error) {
      if (String(error).includes("WORKTREE_LIMIT")) {
        setOpen(false);
        setManagerOpen(true);
      }
      onMessage(error instanceof Error ? error.message : String(error), true);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button
        className="environment-workspace-trigger"
        type="button"
        ref={anchor}
        title={path}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <EnvironmentLocalIcon />
        <span>{label}</span>
        <EnvironmentChevronIcon />
      </button>
      <Popover
        anchorRef={anchor}
        open={open}
        onOpenChange={setOpen}
        label={t("继续至", "Continue in")}
        role="menu"
        placement="inline-start"
        className="environment-workspace-menu"
        id={id}
      >
        <div className="environment-branch-heading">
          {t("继续至", "Continue in")}
        </div>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={!worktree}
          disabled={pending || (worktree && (disabled || !onHandoff))}
          onClick={() => (worktree ? void change("local") : setOpen(false))}
        >
          <EnvironmentLocalIcon />
          <span>{t("本地", "Local")}</span>
          {!worktree && <EnvironmentCheckIcon />}
        </button>
        {worktree && (
          <button
            type="button"
            role="menuitemradio"
            aria-checked
            onClick={() => setOpen(false)}
          >
            <EnvironmentBranchIcon />
            <span>{label}</span>
            <EnvironmentCheckIcon />
          </button>
        )}
        {!worktree && (
          <button
            type="button"
            role="menuitem"
            disabled={disabled || pending || !onHandoff}
            onClick={() => void change("managed-worktree")}
          >
            <EnvironmentBranchIcon />
            <span>
              {pending
                ? t("正在交接…", "Handing off…")
                : t("新建本地工作树", "New local worktree")}
            </span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            setManagerOpen(true);
          }}
        >
          <EnvironmentBranchIcon />
          <span>{t("管理工作树", "Manage worktrees")}</span>
        </button>
        {onOpenUsage && (
          <button
            className="environment-workspace-usage"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenUsage();
            }}
          >
            <ArtemisIcon name="token-usage" data-environment-tone="purple" />
            <span>{t("Token 用量", "Token usage")}</span>
          </button>
        )}
        {(disabled || !onHandoff) && (
          <p className="environment-branch-hint">
            {!onHandoff
              ? t(
                  "创建任务后可切换工作区",
                  "Create a task to switch workspaces",
                )
              : t("请先停止正在运行的任务", "Stop running tasks first")}
          </p>
        )}
      </Popover>
      {managerOpen && (
        <WorktreeManager
          locale={locale}
          onClose={() => setManagerOpen(false)}
          onChanged={onWorktreesChanged}
        />
      )}
    </>
  );
}
