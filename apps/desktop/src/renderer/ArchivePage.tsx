import { UI_COPY } from "../shared/ui-copy.js";
import { useMemo, useState } from "react";
import type { AppLocale, Project, Thread } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { DataSurface } from "@artemis/ui/data";
import { EmptyState } from "@artemis/ui/feedback";
import { SearchField } from "@artemis/ui/forms";
import { ArtemisIcon } from "@artemis/ui/icons";
import { ManagementCard, ManagementHeader } from "@artemis/ui/management";
import archiveHeaderIcon from "./assets/archive-header-icon.png";

import {
  promptWithoutSelectedSkills,
  selectedSkillNamesForPrompt,
} from "./skill-commands.js";

interface ArchivePageProps {
  locale: AppLocale;
  projects: Project[];
  threads: Thread[];
  onOpen(thread: Thread): void;
  onRestore(thread: Thread): void;
  onDelete(thread: Thread): void;
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
  onOpen,
  onRestore,
  onDelete,
}: ArchivePageProps) {
  const [query, setQuery] = useState("");
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
    return archivedThreads.filter((thread) => {
      if (!normalized) return true;
      return `${visibleThreadTitle(thread.title)} ${thread.goal ?? ""} ${thread.projectId ? (projectNames.get(thread.projectId) ?? "") : t.archiveTemporary}`
        .toLocaleLowerCase(locale)
        .includes(normalized);
    });
  }, [archivedThreads, locale, projectNames, query, t.archiveTemporary]);
  const isSearching = query.trim().length > 0;
  const formattedResultCount = new Intl.NumberFormat(locale).format(
    results.length,
  );
  const resultCount = (
    isSearching
      ? results.length === 1
        ? t.archiveMatchOne
        : t.archiveMatchOther
      : results.length === 1
        ? t.archiveCountOne
        : t.archiveCountOther
  ).replace("{count}", formattedResultCount);

  return (
    <DataSurface
      className="archive-page"
      header={
        <ManagementHeader
          className="archive-header"
          description={t.archiveDescription}
          leading={
            <img
              className="archive-header-artwork"
              src={archiveHeaderIcon}
              alt=""
            />
          }
          title={t.archiveTitle}
        />
      }
      label={t.archiveTitle}
      state={results.length === 0 ? "empty" : "ready"}
    >
      <div className="archive-content">
        <div className="archive-toolbar">
          <div className="archive-summary">
            <h2>{t.archiveSectionTitle}</h2>
            <p aria-live="polite">{resultCount}</p>
          </div>
          <SearchField
            className="archive-search"
            label={t.archiveSearch}
            onValueChange={setQuery}
            placeholder={t.archiveSearch}
            value={query}
          />
        </div>

        <div className="archive-results">
          {results.map((thread) => (
            <ManagementCard className="archive-card" key={thread.id}>
              <div className="archive-card-copy">
                <div className="archive-card-heading">
                  <span className="archive-project">
                    {thread.projectId
                      ? (projectNames.get(thread.projectId) ?? "Artemis")
                      : t.archiveTemporary}
                  </span>
                  <time dateTime={thread.updatedAt}>
                    {new Intl.DateTimeFormat(locale, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(thread.updatedAt))}
                  </time>
                </div>
                <h2>{visibleThreadTitle(thread.title)}</h2>
                {thread.goal && (
                  <p className="archive-goal">
                    <strong>{t.archiveGoal}</strong>
                    <span>{thread.goal.objective}</span>
                  </p>
                )}
              </div>
              <div className="archive-card-actions">
                <Button onClick={() => onOpen(thread)} variant="primary">
                  {t.archiveOpen}
                </Button>
                <Button onClick={() => onRestore(thread)} variant="quiet">
                  {t.archiveRestore}
                </Button>
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
              icon={<ArtemisIcon name="archive" />}
              title={
                isSearching ? t.archiveNoResultsTitle : t.archiveEmptyTitle
              }
            />
          )}
        </div>
      </div>
    </DataSurface>
  );
}
