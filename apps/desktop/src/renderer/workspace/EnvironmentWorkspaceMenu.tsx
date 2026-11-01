import { uiTranslator } from "../../shared/i18n/ui-text.js";
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
  placement = "inline-start",
  disabled,
  onHandoff,
  onMessage,
  onOpenUsage,
  onWorktreesChanged,
}: {
  locale: AppLocale;
  path: string;
  worktree?: boolean | undefined;
  placement?: "inline-start" | "block-start";
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
        aria-label={label}
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
        <small className="environment-workspace-path" title={path}>
          {path.length > 38 ? `${path.slice(0, 18)}…${path.slice(-18)}` : path}
        </small>
        <EnvironmentChevronIcon />
      </button>
      <Popover
        anchorRef={anchor}
        open={open}
        onOpenChange={setOpen}
        label={t("EnvironmentWorkspaceMenu.message5")}
        role="menu"
        placement={placement}
        className="environment-workspace-menu"
        id={id}
      >
        <div className="environment-branch-heading">
          {t("EnvironmentWorkspaceMenu.message5")}
        </div>
        <button
          type="button"
          role="menuitemradio"
          aria-label={t("App_copy.local")}
          aria-description={!worktree ? path : undefined}
          aria-checked={!worktree}
          disabled={pending || (worktree && (disabled || !onHandoff))}
          onClick={() => (worktree ? void change("local") : setOpen(false))}
        >
          <EnvironmentLocalIcon />
          <span className="environment-workspace-copy">
            <span>{t("App_copy.local")}</span>
            {!worktree && <small title={path}>{path}</small>}
          </span>
          {!worktree && <EnvironmentCheckIcon />}
        </button>
        {worktree && (
          <button
            type="button"
            role="menuitemradio"
            aria-label={label}
            aria-description={path}
            aria-checked
            onClick={() => setOpen(false)}
          >
            <EnvironmentWorktreeIcon />
            <span className="environment-workspace-copy">
              <span>{label}</span>
              <small title={path}>{path}</small>
            </span>
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
        <div role="separator" />
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
          <>
            <div role="separator" />
            <button
              className="environment-workspace-usage"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenUsage();
              }}
            >
              <ArtemisIcon name="token-usage" />
              <span>{t("App_copy.tokenUsage")}</span>
            </button>
          </>
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
