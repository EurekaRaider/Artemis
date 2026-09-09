import { useEffect, useState } from "react";
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
  const t = (cn: string, en: string) => (locale.startsWith("zh") ? cn : en);
  const [items, setItems] = useState<WorktreeCleanupCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void window.artemis
      .listWorktreeCleanupCandidates()
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
        setSelected(
          rows
            .filter((row) => row.recommended)
            .map((row) => row.worktree.threadId),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const remove = async () => {
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
      setConfirming(false);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      label={t("管理工作树", "Manage worktrees")}
      className="worktree-manager"
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <h2>
        {t("管理工作树", "Manage worktrees")} · {items.length}/10
      </h2>
      <p>
        {t(
          "所有项目合计最多 10 个。默认选择 30 天未更新、已推送到 GitHub 且没有本地文件改动的闲置工作树。",
          "Up to 10 across all projects. Defaults select idle worktrees unchanged for 30 days, pushed to GitHub, and without local file changes.",
        )}
      </p>
      {busy && (
        <p role="status">{t("正在处理，请稍候…", "Working, please wait…")}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {!busy && items.length === 0 && (
        <p>{t("没有需要管理的工作树", "No managed worktrees")}</p>
      )}
      <div className="worktree-manager-list">
        {items.map((item) => (
          <label key={item.worktree.id} className="worktree-manager-item">
            <input
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
            <span>
              <strong>
                {item.projectName} · {item.title}
              </strong>
              <code>{item.worktree.path}</code>
              <small>
                {item.busy
                  ? t(
                      "任务运行中，无法删除",
                      "Task active; deletion unavailable",
                    )
                  : !item.clean
                    ? t(
                        "有本地文件或无法检查，请先处理",
                        "Local files or inspection failed; resolve first",
                      )
                    : item.recommended
                      ? t(
                          "推荐清理 · 已推送 · 超过 30 天",
                          "Recommended · pushed · over 30 days",
                        )
                      : item.pushedToGitHub
                        ? t("已推送到 GitHub", "Pushed to GitHub")
                        : t(
                            "未确认已推送到 GitHub，删除可能丢失本地提交",
                            "GitHub push not confirmed; deletion may lose local commits",
                          )}
              </small>
              {item.error && <small>{item.error}</small>}
            </span>
          </label>
        ))}
      </div>
      {confirming && (
        <p role="alert">
          {t(
            `确认删除选中的 ${selected.length} 个工作树目录？任务记录会保留并切换回本地；未推送的提交可能丢失。`,
            `Delete ${selected.length} selected worktree directories? Tasks remain and return to Local; unpushed commits may be lost.`,
          )}
        </p>
      )}
      <div className="worktree-manager-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          {t("关闭", "Close")}
        </button>
        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => (confirming ? void remove() : setConfirming(true))}
        >
          {confirming
            ? t("确认删除", "Confirm deletion")
            : t(
                `删除所选 (${selected.length})`,
                `Delete selected (${selected.length})`,
              )}
        </button>
      </div>
    </Dialog>
  );
}
