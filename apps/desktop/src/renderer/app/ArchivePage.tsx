import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { AppLocale, Project, Thread } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { DataSurface } from "@artemis/ui/data";
import { EmptyState } from "@artemis/ui/feedback";
import { SegmentedControl } from "@artemis/ui/navigation";
import { uiText } from "../../shared/i18n/ui-text.js";
import { statusText } from "../../shared/i18n/status-text.js";
import { Checkbox, Select, SearchField } from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ManagementCard, ManagementHeader } from "@artemis/ui/management";

import {
  promptWithoutSelectedSkills,
  selectedSkillNamesForPrompt,
} from "../plugins/skill-commands.js";

interface ArchivePageProps {
  locale: AppLocale;
  projects: Project[];
  threads: Thread[];
  groupThreadIds?: ReadonlySet<string>;
  onOpen(thread: Thread): void;
  onRestore(thread: Thread): void;
  onDelete(thread: Thread): void;
  onBatch(
    threads: Thread[],
    operation: "restore" | "delete",
  ): Promise<string[] | undefined>;
}

function visibleThreadTitle(title: string): string {
  return (
    promptWithoutSelectedSkills(title) ||
    selectedSkillNamesForPrompt(title).join(", ") ||
    title
  );
}

const labels = UI_COPY.ArchivePage_labels;

export function ArchivePage({
  locale,
  projects,
  threads,
  groupThreadIds,
  onOpen,
  onRestore,
  onDelete,
  onBatch,
}: ArchivePageProps) {
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [groupBy, setGroupBy] = useState<"time" | "project">("time");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  useEffect(() => {
    setSelected(new Set());
    setBatchError("");
  }, [query, projectFilter, groupBy]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const batch = async (operation: "restore" | "delete") => {
    if (batchBusy) return;
    setBatchBusy(true);
    setBatchError("");
    try {
      const succeeded = await onBatch(
        threads.filter((thread) => selected.has(thread.id)),
        operation,
      );
      if (!succeeded) return;
      const remaining = new Set(
        [...selected].filter((id) => !succeeded.includes(id)),
      );
      setSelected(
        (current) => new Set([...remaining].filter((id) => current.has(id))),
      );
      if (remaining.size)
        setBatchError(
          uiText(locale, "Review06.bulkFailed", { count: remaining.size }),
        );
    } catch {
      setBatchError(
        uiText(locale, "Review06.bulkFailed", { count: selected.size }),
      );
    } finally {
      setBatchBusy(false);
    }
  };
  const t = labels[locale];
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const archivedThreads = useMemo(
    () =>
      threads
        .filter((thread) => thread.archived)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [threads],
  );
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return archivedThreads
      .filter((thread) => {
        if (
          projectFilter &&
          (thread.projectId ?? "temporary") !== projectFilter
        )
          return false;
        if (!normalized) return true;
        return `${visibleThreadTitle(thread.title)} ${thread.goal ?? ""} ${thread.projectId ? (projectNames.get(thread.projectId) ?? "") : t.archiveTemporary}`
          .toLocaleLowerCase(locale)
          .includes(normalized);
      })
      .sort((a, b) =>
        groupBy === "project"
          ? (
              projectNames.get(a.projectId ?? "") ?? t.archiveTemporary
            ).localeCompare(
              projectNames.get(b.projectId ?? "") ?? t.archiveTemporary,
              locale,
            ) || b.updatedAt.localeCompare(a.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [
    archivedThreads,
    locale,
    projectNames,
    query,
    projectFilter,
    groupBy,
    t.archiveTemporary,
  ]);
  const isSearching = query.trim().length > 0 || projectFilter.length > 0;
  const groupLabel = (thread: Thread) =>
    groupBy === "project"
      ? (projectNames.get(thread.projectId ?? "") ?? t.archiveTemporary)
      : new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "long",
        }).format(new Date(thread.updatedAt));

  return (
    <DataSurface
      className="archive-page"
      header={
        <ManagementHeader
          className="archive-header"
          description={t.archiveDescription}
          title={t.archiveTitle}
        />
      }
      label={t.archiveTitle}
      state={results.length === 0 ? "empty" : "ready"}
    >
      <div className="archive-content">
        <div className="archive-toolbar">
          <SearchField
            className="archive-search"
            label={t.archiveSearch}
            onValueChange={setQuery}
            placeholder={t.archiveSearch}
            value={query}
          />
          <Select
            label={uiText(locale, "AutomationPage_text.allProjects")}
            labelVisibility="hidden"
            size="compact"
            value={projectFilter}
            onValueChange={setProjectFilter}
            options={[
              {
                value: "",
                label: uiText(locale, "AutomationPage_text.allProjects"),
              },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
              { value: "temporary", label: t.archiveTemporary },
            ]}
          />
          <SegmentedControl
            label={t.archiveSectionTitle}
            size="compact"
            value={groupBy}
            onValueChange={setGroupBy}
            options={[
              { value: "time", label: uiText(locale, "Review01.byTime") },
              { value: "project", label: uiText(locale, "Review01.byProject") },
            ]}
          />
        </div>

        <div className="archive-results">
          {results.map((thread, index) => (
            <Fragment key={thread.id}>
              {(index === 0 ||
                groupLabel(results[index - 1]!) !== groupLabel(thread)) && (
                <h3 className="archive-time-group">
                  <span>{groupLabel(thread)}</span>
                  <span>
                    {
                      results.filter(
                        (item) => groupLabel(item) === groupLabel(thread),
                      ).length
                    }
                  </span>
                </h3>
              )}
              <ManagementCard className="archive-card">
                <Checkbox
                  className="archive-select"
                  label={visibleThreadTitle(thread.title)}
                  labelVisibility="hidden"
                  checked={selected.has(thread.id)}
                  disabled={batchBusy}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(thread.id);
                      else next.delete(thread.id);
                      return next;
                    })
                  }
                />
                <ArtemisIcon
                  className="archive-thread-icon"
                  name={
                    groupThreadIds?.has(thread.id)
                      ? "agents"
                      : thread.projectId
                        ? "plan"
                        : "chat"
                  }
                />
                <div className="archive-card-copy">
                  <h2>{visibleThreadTitle(thread.title)}</h2>
                  <p className="archive-subtitle">
                    {UI_COPY.App_copy[locale][thread.mode]} ·{" "}
                    {statusText(locale, thread.status)}
                  </p>
                  {thread.goal && (
                    <p className="archive-goal">
                      <strong>{t.archiveGoal}</strong>
                      <span>{thread.goal.objective}</span>
                    </p>
                  )}
                </div>
                <div className="archive-card-heading">
                  <span className="archive-project">
                    {thread.projectId
                      ? (projectNames.get(thread.projectId) ?? "Artemis")
                      : t.archiveTemporary}
                  </span>
                  <time dateTime={thread.updatedAt}>
                    {new Intl.DateTimeFormat(locale, {
                      month: "2-digit",
                      day: "2-digit",
                      ...(new Date(thread.updatedAt).getFullYear() !==
                      new Date().getFullYear()
                        ? { year: "numeric" as const }
                        : {}),
                    }).format(new Date(thread.updatedAt))}
                  </time>
                </div>
                <div className="archive-card-actions">
                  <IconButton
                    icon={<ArtemisIcon name="undo" />}
                    label={`${t.archiveRestore}: ${thread.title}`}
                    title={t.archiveRestore}
                    onClick={() => onRestore(thread)}
                    variant="quiet"
                  />
                  <IconButton
                    icon={<ArtemisIcon name="external" />}
                    label={`${t.archiveOpen}: ${thread.title}`}
                    title={t.archiveOpen}
                    onClick={() => onOpen(thread)}
                    variant="quiet"
                  />
                  <IconButton
                    className="management-destructive-action"
                    icon={<ArtemisIcon name="trash" />}
                    label={`${t.archiveDelete}: ${thread.title}`}
                    title={t.archiveDelete}
                    onClick={() => onDelete(thread)}
                    variant="quiet"
                  />
                </div>
              </ManagementCard>
            </Fragment>
          ))}
          {results.length === 0 && (
            <EmptyState
              action={
                isSearching ? (
                  <Button onClick={() => setQuery("")}>
                    {t.archiveClearSearch}
                  </Button>
                ) : undefined
              }
              className="archive-empty"
              description={
                isSearching
                  ? t.archiveNoResultsDescription
                  : t.archiveEmptyDescription
              }
              icon={<ArtemisIcon name="archive" width={32} height={32} />}
              title={
                isSearching ? t.archiveNoResultsTitle : t.archiveEmptyTitle
              }
            />
          )}
        </div>
      </div>
      {batchError && (
        <p className="archive-batch-error" role="alert">
          {batchError}
        </p>
      )}
      {selected.size > 0 && (
        <div
          className="archive-batch-bar"
          role="toolbar"
          aria-label={uiText(locale, "Review06.selectedCount", {
            count: selected.size,
          })}
        >
          <span>
            {uiText(locale, "Review06.selectedCount", { count: selected.size })}
          </span>
          <i aria-hidden="true" />
          <Button
            className="archive-batch-action"
            size="compact"
            disabled={batchBusy}
            onClick={() => void batch("restore")}
          >
            <ArtemisIcon name="undo" width={14} height={14} />
            {UI_COPY.App_copy[locale].restoreTask}
          </Button>
          <Button
            className="archive-batch-action danger"
            size="compact"
            disabled={batchBusy}
            onClick={() => void batch("delete")}
          >
            <ArtemisIcon name="trash" width={14} height={14} />
            {uiText(locale, "Review06.permanentDelete")}
          </Button>
          <IconButton
            size="compact"
            variant="quiet"
            icon={<ArtemisIcon name="close" width={14} height={14} />}
            label={uiText(locale, "Review06.clearSelection")}
            onClick={() => setSelected(new Set())}
          />
        </div>
      )}
    </DataSurface>
  );
}
