import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import type { AppLocale, Thread, ThreadGoal } from "@artemis/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const COPY = {
  en: {
    goal: "Goal",
    loading: "Loading Goal…",
    updatedNow: "Updated just now",
    updatedMinutes: "Updated {{count}} min ago",
    revert: "Revert",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    stale: "This Goal changed elsewhere. Reload to load the latest version.",
    staleDirty: "You have unsaved changes; reloading will discard them.",
    loadFailed: "Failed to load goal objective.",
    saveFailed: "Failed to save goal objective.",
    retryLoad: "Retry loading",
    retrySave: "Retry saving",
    reload: "Reload",
    reloadConfirm: "Discard changes and reload",
  },
  "zh-CN": {
    goal: "目标",
    loading: "正在载入目标…",
    updatedNow: "刚刚更新",
    updatedMinutes: "{{count}} 分钟前更新",
    revert: "还原",
    save: "保存",
    saving: "正在保存…",
    saved: "已保存",
    stale: "此目标已在其他位置发生变化。重新加载以获取最新版本。",
    staleDirty: "你有未保存的修改，重新加载将丢弃它们。",
    loadFailed: "载入目标内容失败。",
    saveFailed: "保存目标内容失败。",
    retryLoad: "重试加载",
    retrySave: "重试保存",
    reload: "重新加载",
    reloadConfirm: "放弃修改并重新加载",
  },
} as const;

type GoalEditorStatus =
  | { kind: "loading" }
  | { kind: "ready"; source: string; draft: string; saved: boolean }
  | { kind: "saving"; source: string; draft: string }
  | { kind: "load-error"; message: string }
  | {
      kind: "save-error";
      source: string;
      draft: string;
      message: string;
    }
  | { kind: "stale"; source: string | undefined; draft: string };

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
  const [status, setStatus] = useState<GoalEditorStatus>({ kind: "loading" });
  const [revision, setRevision] = useState(goal.revision);
  const [persistedObjective, setPersistedObjective] = useState(goal.objective);
  const [reloadConfirmed, setReloadConfirmed] = useState(false);
  const loadTokenRef = useRef(0);
  const saveTokenRef = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const focusAfterRecoveryRef = useRef(false);

  const load = useCallback(async () => {
    const token = (loadTokenRef.current += 1);
    setStatus({ kind: "loading" });
    try {
      const result = await window.artemis.getThreadGoalObjective(goal.threadId);
      if (token !== loadTokenRef.current) return;
      if (result.goalId !== goal.goalId) {
        setStatus({ kind: "stale", source: undefined, draft: "" });
        return;
      }
      setStatus({
        kind: "ready",
        source: result.objective,
        draft: result.objective,
        saved: false,
      });
      setRevision(result.revision);
      setPersistedObjective(goal.objective);
    } catch (error) {
      if (token !== loadTokenRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      const notice = `${copy.loadFailed} ${message}`;
      onError(notice);
      setStatus({ kind: "load-error", message: notice });
    }
  }, [copy.loadFailed, goal.goalId, goal.objective, goal.threadId, onError]);

  useEffect(() => {
    void load();
  }, [goal.goalId]);

  // Whether the editor currently holds unsaved edits. Loading and saving are
  // transient phases and never count as dirty, so a status phase change alone
  // cannot retrigger the external-change effect below (which would loop).
  const dirtySnapshot =
    (status.kind === "ready" || status.kind === "save-error") &&
    status.draft !== status.source;

  useEffect(() => {
    if (goal.objective === persistedObjective) {
      setRevision(goal.revision);
      return;
    }
    if (dirtySnapshot) {
      setStatus((current) => {
        if (current.kind === "stale") return current;
        const source =
          current.kind === "ready" ||
          current.kind === "saving" ||
          current.kind === "save-error"
            ? current.source
            : undefined;
        const draft =
          current.kind === "ready" ||
          current.kind === "saving" ||
          current.kind === "save-error"
            ? current.draft
            : "";
        return { kind: "stale", source, draft };
      });
      return;
    }
    void load();
  }, [dirtySnapshot, goal.objective, goal.revision, load, persistedObjective]);

  useEffect(() => {
    if (status.kind !== "ready" || !focusAfterRecoveryRef.current) return;
    focusAfterRecoveryRef.current = false;
    editorRef.current?.focus();
  }, [status]);

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
    if (status.kind !== "ready" && status.kind !== "save-error") return;
    const draft = status.draft;
    const source = status.source;
    const objective = draft.trim();
    if (!objective || draft === source) return;
    const token = (saveTokenRef.current += 1);
    setStatus({ kind: "saving", source, draft });
    try {
      const thread = await window.artemis.updateThreadGoalObjective(
        goal.threadId,
        objective,
        goal.goalId,
        revision,
      );
      if (token !== saveTokenRef.current) return;
      const updatedGoal = thread.goal;
      if (!updatedGoal || updatedGoal.goalId !== goal.goalId) {
        setStatus({ kind: "stale", source, draft });
        return;
      }
      setStatus({
        kind: "ready",
        source: updatedGoal.objective,
        draft: updatedGoal.objective,
        saved: true,
      });
      setRevision(updatedGoal.revision);
      onSaved(thread);
    } catch (error) {
      if (token !== saveTokenRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("changed while")) {
        setStatus({ kind: "stale", source, draft });
        return;
      }
      const notice = `${copy.saveFailed} ${message}`;
      onError(notice);
      setStatus({ kind: "save-error", source, draft, message: notice });
    }
  }, [
    copy.saveFailed,
    goal.goalId,
    goal.threadId,
    onError,
    onSaved,
    revision,
    status,
  ]);

  const dirty =
    ((status.kind === "ready" || status.kind === "save-error") &&
      status.draft.trim() !== "" &&
      status.draft !== status.source) ||
    (status.kind === "stale" &&
      status.source !== undefined &&
      status.draft !== status.source);
  const busy = status.kind === "loading" || status.kind === "saving";

  const handleRetryLoad = () => {
    focusAfterRecoveryRef.current = true;
    setReloadConfirmed(false);
    void load();
  };
  const handleRetrySave = () => {
    focusAfterRecoveryRef.current = true;
    void save();
  };
  const handleReload = () => {
    if (dirty && !reloadConfirmed) {
      setReloadConfirmed(true);
      return;
    }
    focusAfterRecoveryRef.current = true;
    setReloadConfirmed(false);
    void load();
  };

  const draftValue =
    status.kind === "ready" ||
    status.kind === "saving" ||
    status.kind === "save-error" ||
    status.kind === "stale"
      ? status.draft
      : "";

  return (
    <section aria-busy={busy || undefined} className="goal-editor-panel">
      {status.kind === "loading" && (
        <div className="goal-editor-loading">{copy.loading}</div>
      )}
      {status.kind !== "loading" && (
        <textarea
          aria-label={copy.goal}
          autoFocus={true}
          className="goal-editor-input"
          disabled={status.kind === "saving" || status.kind === "stale"}
          onChange={(event) => {
            if (status.kind !== "ready" && status.kind !== "save-error") return;
            setStatus({
              kind: "ready",
              source: status.source,
              draft: event.target.value,
              saved: false,
            });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
              return;
            }
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            void save();
          }}
          placeholder={copy.goal}
          ref={editorRef}
          spellCheck={true}
          value={draftValue}
        />
      )}
      {status.kind === "load-error" && (
        <p className="goal-editor-stale" role="alert">
          {status.message}{" "}
          <button onClick={handleRetryLoad} type="button">
            {copy.retryLoad}
          </button>
        </p>
      )}
      {status.kind === "save-error" && (
        <p className="goal-editor-stale" role="alert">
          {status.message}{" "}
          <button onClick={handleRetrySave} type="button">
            {copy.retrySave}
          </button>
        </p>
      )}
      {status.kind === "stale" && (
        <p className="goal-editor-stale" role="alert">
          {dirty ? `${copy.staleDirty} ` : ""}
          {copy.stale}{" "}
          <button onClick={handleReload} type="button">
            {dirty && reloadConfirmed ? copy.reloadConfirm : copy.reload}
          </button>
        </p>
      )}
      <footer className="goal-editor-footer">
        <span>{updatedLabel}</span>
        <div>
          {status.kind === "ready" && status.saved && (
            <span aria-live="polite" className="goal-editor-saved">
              {copy.saved}
            </span>
          )}
          <button
            aria-label={copy.revert}
            className="goal-editor-revert"
            disabled={!dirty || busy || status.kind === "stale"}
            onClick={() => {
              if (status.kind !== "ready" && status.kind !== "save-error") {
                return;
              }
              setStatus({
                kind: "ready",
                source: status.source,
                draft: status.source,
                saved: false,
              });
            }}
            title={copy.revert}
            type="button"
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" size={14} />
          </button>
          <button
            className="primary-button"
            disabled={!dirty || busy || status.kind === "stale"}
            onClick={() => void save()}
            type="button"
          >
            {status.kind === "saving" ? copy.saving : copy.save}
          </button>
        </div>
      </footer>
    </section>
  );
}
