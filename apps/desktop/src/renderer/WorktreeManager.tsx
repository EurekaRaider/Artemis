import { uiTranslator } from "../shared/ui-text.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@artemis/ui/feedback";
import type { AppLocale } from "@artemis/protocol";
import type { WorktreeCleanupCandidate } from "../shared/api.js";

export function WorktreeManager({
  locale,
  onClose,
  onChanged,
}: {
  locale: AppLocale;
  onClose: () => void;
  onChanged?: (() => Promise<void>) | undefined;
}) {
  const t = uiTranslator(locale);
  const [items, setItems] = useState<WorktreeCleanupCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const request = useRef(0);
  const loaded = useRef(false);
  const removing = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    setBusy(true);
    setConfirming(false);
    try {
      const rows = await window.artemis.listWorktreeCleanupCandidates();
      if (request.current !== id) return;
      const initial = !loaded.current;
      loaded.current = true;
      setItems(rows);
      setSelected((current) =>
        rows
          .filter(
            (row) =>
              !row.busy &&
              row.clean &&
              (initial
                ? row.recommended
                : current.includes(row.worktree.threadId)),
          )
          .map((row) => row.worktree.threadId),
      );
    } catch (reason) {
      if (request.current === id) setError(String(reason));
    } finally {
      if (request.current === id) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const refreshOnFocus = () => {
      if (!removing.current) void refresh();
    };
    void refresh();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      ++request.current;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh]);
  const remove = async () => {
    removing.current = true;
    ++request.current;
    setBusy(true);
    setError("");
    try {
      for (const id of selected) {
        await window.artemis.cleanupWorktree(id, false);
        setItems((rows) => rows.filter((row) => row.worktree.threadId !== id));
        setSelected((ids) => ids.filter((value) => value !== id));
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      try {
        await onChanged?.();
      } catch (reason) {
        setError(String(reason));
      }
      await refresh();
      removing.current = false;
    }
  };
  return (
    <Dialog
      open
      label={t("EnvironmentWorkspaceMenu.message9")}
      className="worktree-manager"
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <h2>
        {t("EnvironmentWorkspaceMenu.message9")} · {items.length}/10
      </h2>
      <p>{t("WorktreeManager.message2")}</p>
      {busy && <p role="status">{t("WorktreeManager.message3")}</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && items.length === 0 && <p>{t("WorktreeManager.message4")}</p>}
      <div className="worktree-manager-list">
        {items.map((item) => (
          <label
            key={item.worktree.id}
            className="worktree-manager-item"
            data-artemis-component="checkbox"
            data-state={
              busy || item.busy || !item.clean
                ? "disabled"
                : selected.includes(item.worktree.threadId)
                  ? "checked"
                  : "ready"
            }
          >
            <input
              data-part="control"
              type="checkbox"
              disabled={busy || item.busy || !item.clean}
              checked={selected.includes(item.worktree.threadId)}
              onChange={(event) => {
                setConfirming(false);
                setSelected(
                  event.target.checked
                    ? [...selected, item.worktree.threadId]
                    : selected.filter((id) => id !== item.worktree.threadId),
                );
              }}
            />
            <span aria-hidden="true" data-part="indicator">
              {selected.includes(item.worktree.threadId) ? "✓" : ""}
            </span>
            <span>
              <strong>
                {item.projectName} · {item.title}
              </strong>
              <code>{item.worktree.path}</code>
              <small>
                {item.busy
                  ? t("WorktreeManager.message9")
                  : !item.clean
                    ? t("WorktreeManager.message8")
                    : item.recommended
                      ? t("WorktreeManager.message7")
                      : item.pushedToGitHub
                        ? t("WorktreeManager.message6")
                        : t("WorktreeManager.message5")}
              </small>
              {item.error && <small>{item.error}</small>}
            </span>
          </label>
        ))}
      </div>
      {confirming && (
        <p role="alert">
          {t("WorktreeManager.message10", { value1: selected.length })}
        </p>
      )}
      <div className="worktree-manager-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          {t("App_copy.renameClose")}
        </button>
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => (confirming ? void remove() : setConfirming(true))}
        >
          {confirming
            ? t("WorktreeManager.message13")
            : t("WorktreeManager.message12", { value1: selected.length })}
        </button>
      </div>
    </Dialog>
  );
}
