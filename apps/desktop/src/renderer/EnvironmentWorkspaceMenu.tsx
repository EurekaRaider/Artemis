import { uiTranslator } from "../shared/ui-text.js";
import { WorktreeManager } from "./WorktreeManager.js";
import { useId, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Popover } from "@artemis/ui/feedback";
import {
  EnvironmentCheckIcon,
  EnvironmentChevronIcon,
  EnvironmentLocalIcon,
  EnvironmentWorktreeIcon,
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
  const t = uiTranslator(locale);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [managerOpen, setManagerOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const label = worktree
    ? t("EnvironmentWorkspaceMenu.message2")
    : t("App_copy.local");
  const change = async (destination: "local" | "managed-worktree") => {
    if (!onHandoff || disabled || pending) return;
    setPending(true);
    try {
      await onHandoff(destination);
      setOpen(false);
      onMessage(
        destination === "local"
          ? t("EnvironmentWorkspaceMenu.message4")
          : t("EnvironmentWorkspaceMenu.message3"),
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
        {worktree ? <EnvironmentWorktreeIcon /> : <EnvironmentLocalIcon />}
        <span>{label}</span>
        <EnvironmentChevronIcon />
      </button>
      <Popover
        anchorRef={anchor}
        open={open}
        onOpenChange={setOpen}
        label={t("EnvironmentWorkspaceMenu.message5")}
        role="menu"
        placement="inline-start"
        className="environment-workspace-menu"
        id={id}
      >
        <div className="environment-branch-heading">
          {t("EnvironmentWorkspaceMenu.message5")}
        </div>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={!worktree}
          disabled={pending || (worktree && (disabled || !onHandoff))}
          onClick={() => (worktree ? void change("local") : setOpen(false))}
        >
          <EnvironmentLocalIcon />
          <span>{t("App_copy.local")}</span>
          {!worktree && <EnvironmentCheckIcon />}
        </button>
        {worktree && (
          <button
            type="button"
            role="menuitemradio"
            aria-checked
            onClick={() => setOpen(false)}
          >
            <EnvironmentWorktreeIcon />
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
            <EnvironmentWorktreeIcon />
            <span>
              {pending
                ? t("EnvironmentWorkspaceMenu.message8")
                : t("EnvironmentWorkspaceMenu.message7")}
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
          <EnvironmentWorktreeIcon />
          <span>{t("EnvironmentWorkspaceMenu.message9")}</span>
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
            <span>{t("App_copy.tokenUsage")}</span>
          </button>
        )}
        {(disabled || !onHandoff) && (
          <p className="environment-branch-hint">
            {!onHandoff
              ? t("EnvironmentWorkspaceMenu.message12")
              : t("EnvironmentWorkspaceMenu.message11")}
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
