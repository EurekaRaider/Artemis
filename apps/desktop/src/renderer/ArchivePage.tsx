import { useMemo, useState } from "react";
import type { AppLocale, Project, Thread } from "@artemis/protocol";

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
    title: "Archived conversations",
    description:
      "Archived tasks stay searchable and keep their complete local history.",
    search: "Search archived conversations or projects",
    open: "Open conversation",
    restore: "Restore to tasks",
    delete: "Delete conversation",
    empty: "No archived conversations match this search.",
    goal: "Goal",
    temporary: "Temporary conversation",
  },
  "zh-CN": {
    title: "已归档对话",
    description: "归档任务仍可查询，并完整保留本地对话历史。",
    search: "搜索已归档对话或项目",
    open: "打开对话",
    restore: "恢复到任务",
    delete: "删除对话",
    empty: "没有符合条件的已归档对话。",
    goal: "目标",
    temporary: "临时会话",
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
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return threads
      .filter((thread) => thread.archived)
      .filter((thread) => {
        if (!normalized) return true;
        return `${visibleThreadTitle(thread.title)} ${thread.goal ?? ""} ${thread.projectId ? (projectNames.get(thread.projectId) ?? "") : t.temporary}`
          .toLocaleLowerCase(locale)
          .includes(normalized);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [locale, projectNames, query, t.temporary, threads]);

  return (
    <div className="archive-page">
      <section aria-labelledby="archive-page-title" className="archive-panel">
        <header className="archive-header">
          <span className="archive-header-icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M4 7.5h16v11H4zM3.5 4.5h17v3h-17zM9 11h6" />
            </svg>
          </span>
          <div className="archive-heading">
            <h1 id="archive-page-title">{t.title}</h1>
            <p>{t.description}</p>
          </div>
        </header>

        <div className="archive-content">
          <label className="archive-search">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.8" cy="10.8" r="6.3" />
              <path d="m15.5 15.5 4.2 4.2" />
            </svg>
            <input
              aria-label={t.search}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.search}
              value={query}
            />
          </label>

          <div className="archive-results">
            {results.map((thread) => (
              <article className="archive-card" key={thread.id}>
                <div className="archive-card-copy">
                  <div className="archive-card-heading">
                    <span className="archive-project">
                      {thread.projectId
                        ? (projectNames.get(thread.projectId) ?? "Artemis")
                        : t.temporary}
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
                      <strong>{t.goal}</strong>
                      <span>{thread.goal}</span>
                    </p>
                  )}
                </div>
                <div className="archive-card-actions">
                  <button
                    className="archive-primary"
                    onClick={() => onOpen(thread)}
                    type="button"
                  >
                    {t.open}
                  </button>
                  <button
                    className="archive-secondary"
                    onClick={() => onRestore(thread)}
                    type="button"
                  >
                    {t.restore}
                  </button>
                  <button
                    className="archive-secondary danger"
                    onClick={() => onDelete(thread)}
                    type="button"
                  >
                    {t.delete}
                  </button>
                </div>
              </article>
            ))}
            {results.length === 0 && (
              <div className="archive-empty">
                <span className="archive-empty-icon">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M4 7.5h16v11H4zM3.5 4.5h17v3h-17zM9 11h6" />
                  </svg>
                </span>
                <p>{t.empty}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
