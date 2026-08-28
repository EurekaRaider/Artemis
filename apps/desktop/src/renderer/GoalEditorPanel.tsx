import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import type { AppLocale, Thread, ThreadGoal } from "@artemis/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";

const COPY = {
  en: {
    goal: "Goal",
    loading: "Loading Goal…",
    updatedNow: "Updated just now",
    updatedMinutes: "Updated {{count}} min ago",
    revert: "Revert",
    save: "Save",
    saving: "Saving…",
    stale: "This Goal changed elsewhere. Close this editor and open it again.",
    loadFailed: "Failed to load goal objective.",
    saveFailed: "Failed to save goal objective.",
  },
  "zh-CN": {
    goal: "目标",
    loading: "正在载入目标…",
    updatedNow: "刚刚更新",
    updatedMinutes: "{{count}} 分钟前更新",
    revert: "还原",
    save: "保存",
    saving: "正在保存…",
    stale: "此目标已在其他位置发生变化。请关闭编辑器后重新打开。",
    loadFailed: "载入目标内容失败。",
    saveFailed: "保存目标内容失败。",
  },
} as const;

export function GoalEditorPanel({
  clockMs,
  goal,
  locale,
  onError,
  onSaved,
}: {
  clockMs: number;
  goal: ThreadGoal;
  locale: AppLocale;
  onError(message: string): void;
  onSaved(thread: Thread): void;
}) {
  const copy = locale.startsWith("zh") ? COPY["zh-CN"] : COPY.en;
  const [source, setSource] = useState<string>();
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState(goal.revision);
  const [persistedObjective, setPersistedObjective] = useState(goal.objective);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await window.artemis.getThreadGoalObjective(goal.threadId);
      if (result.goalId !== goal.goalId) {
        setStale(true);
        return;
      }
      setSource(result.objective);
      setDraft(result.objective);
      setRevision(result.revision);
      setPersistedObjective(goal.objective);
      setStale(false);
    } catch (error) {
      onError(
        `${copy.loadFailed} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [copy.loadFailed, goal.goalId, goal.objective, goal.threadId, onError]);

  useEffect(() => {
    void load();
  }, [goal.goalId]);

  useEffect(() => {
    if (goal.objective === persistedObjective) {
      setRevision(goal.revision);
      return;
    }
    if (source !== undefined && draft !== source) {
      setStale(true);
      return;
    }
    void load();
  }, [draft, goal.objective, goal.revision, load, persistedObjective, source]);

  const dirty = source !== undefined && draft !== source;
  const updatedLabel = useMemo(() => {
    const updatedAt = Date.parse(goal.updatedAt);
    const minutes = Number.isFinite(updatedAt)
      ? Math.max(0, Math.floor((clockMs - updatedAt) / 60_000))
      : 0;
    return minutes < 1
      ? copy.updatedNow
      : copy.updatedMinutes.replace("{{count}}", String(minutes));
  }, [clockMs, copy.updatedMinutes, copy.updatedNow, goal.updatedAt]);

  const save = useCallback(async () => {
    const objective = draft.trim();
    if (!dirty || !objective || saving || stale) return;
    setSaving(true);
    try {
      const thread = await window.artemis.updateThreadGoalObjective(
        goal.threadId,
        objective,
        goal.goalId,
        revision,
      );
      const updatedGoal = thread.goal;
      if (!updatedGoal || updatedGoal.goalId !== goal.goalId) {
        setStale(true);
        return;
      }
      setSource(objective);
      setDraft(objective);
      setRevision(updatedGoal.revision);
      setPersistedObjective(updatedGoal.objective);
      onSaved(thread);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("changed while")) setStale(true);
      onError(`${copy.saveFailed} ${message}`);
    } finally {
      setSaving(false);
    }
  }, [
    copy.saveFailed,
    dirty,
    draft,
    goal.goalId,
    goal.threadId,
    onError,
    onSaved,
    revision,
    saving,
    stale,
  ]);

  return (
    <section aria-busy={saving} className="goal-editor-panel">
      {source === undefined ? (
        <div className="goal-editor-loading">{copy.loading}</div>
      ) : (
        <textarea
          aria-label={copy.goal}
          autoFocus={true}
          className="goal-editor-input"
          disabled={saving || stale}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
              return;
            }
            event.preventDefault();
            void save();
          }}
          placeholder={copy.goal}
          spellCheck={true}
          value={draft}
        />
      )}
      {stale && (
        <p className="goal-editor-stale" role="alert">
          {copy.stale}
        </p>
      )}
      <footer className="goal-editor-footer">
        <span>{updatedLabel}</span>
        <div>
          <button
            aria-label={copy.revert}
            className="goal-editor-revert"
            disabled={!dirty || saving || stale}
            onClick={() => setDraft(source ?? "")}
            title={copy.revert}
            type="button"
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" size={14} />
          </button>
          <button
            className="primary-button"
            disabled={!dirty || !draft.trim() || saving || stale}
            onClick={() => void save()}
            type="button"
          >
            {saving ? copy.saving : copy.save}
          </button>
        </div>
      </footer>
    </section>
  );
}
