import { useMemo, useState } from "react";
import type { AppLocale, Project, Thread } from "@artemis/protocol";
import { Button, Icon } from "@artemis/ui/actions";
import { DataSurface } from "@artemis/ui/data";
import { EmptyState } from "@artemis/ui/feedback";
import { SearchField } from "@artemis/ui/forms";
import { ManagementCard, ManagementHeader } from "@artemis/ui/management";

import {
  promptWithoutSelectedSkills,
  selectedSkillNamesForPrompt,
} from "./skill-commands.js";
import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";

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

const labels = {
  en: {
    archiveTitle: "Archived conversations",
    archiveDescription:
      "Archived tasks stay searchable and keep their complete local history.",
    archiveSearch: "Search archived conversations or projects",
    archiveOpen: "Open conversation",
    archiveRestore: "Restore to tasks",
    archiveDelete: "Delete conversation",
    archiveSectionTitle: "Conversation history",
    archiveCountOne: "{count} archived conversation",
    archiveCountOther: "{count} archived conversations",
    archiveMatchOne: "{count} match",
    archiveMatchOther: "{count} matches",
    archiveEmptyTitle: "No archived conversations yet",
    archiveEmptyDescription:
      "Conversations you archive will appear here, ready to open, restore, or delete.",
    archiveNoResultsTitle: "No matching conversations",
    archiveNoResultsDescription: "Try another title, goal, or project name.",
    archiveClearSearch: "Clear search",
    archiveGoal: "Goal",
    archiveTemporary: "Temporary chat",
  },
  "zh-CN": {
    archiveTitle: "已归档对话",
    archiveDescription: "归档任务仍可查询，并完整保留本地对话历史。",
    archiveSearch: "搜索已归档对话或项目",
    archiveOpen: "打开对话",
    archiveRestore: "恢复到任务",
    archiveDelete: "删除对话",
    archiveSectionTitle: "归档记录",
    archiveCountOne: "{count} 个归档对话",
    archiveCountOther: "{count} 个归档对话",
    archiveMatchOne: "{count} 个结果",
    archiveMatchOther: "{count} 个结果",
    archiveEmptyTitle: "还没有归档对话",
    archiveEmptyDescription:
      "归档后的任务会显示在这里，可随时打开、恢复或删除。",
    archiveNoResultsTitle: "没有找到匹配的对话",
    archiveNoResultsDescription: "请尝试搜索其他标题、目标或项目名称。",
    archiveClearSearch: "清除搜索",
    archiveGoal: "目标",
    archiveTemporary: "临时会话",
  },
} as const;

export function ArchivePage({
  locale,
  projects,
  threads,
  onOpen,
  onRestore,
  onDelete,
}: ArchivePageProps) {
  const [query, setQuery] = useState("");
  const t = localizedCopy(locale, "app", labels[legacyLocale(locale)]);
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
            <Icon className="archive-header-icon">
              <svg viewBox="0 0 24 24">
                <path d="M4 7.5h16v11H4zM3.5 4.5h17v3h-17zM9 11h6" />
              </svg>
            </Icon>
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
                <Button onClick={() => onRestore(thread)}>
                  {t.archiveRestore}
                </Button>
                <Button onClick={() => onDelete(thread)} variant="danger">
                  {t.archiveDelete}
                </Button>
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
              icon={
                <svg viewBox="0 0 24 24">
                  <path d="M4 7.5h16v11H4zM3.5 4.5h17v3h-17zM9 11h6" />
                </svg>
              }
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
