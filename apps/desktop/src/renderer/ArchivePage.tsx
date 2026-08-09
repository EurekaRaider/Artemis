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
    eyebrow: "Conversation library",
    title: "Archived conversations",
    description:
      "Archived tasks stay searchable and keep their complete local history.",
    search: "Search archived conversations or projects",
    open: "Open conversation",
    restore: "Restore to tasks",
    delete: "Delete conversation",
    empty: "No archived conversations match this search.",
    goal: "Goal",
  },
  "zh-CN": {
    eyebrow: "对话资料库",
    title: "已归档对话",
    description: "归档任务仍可查询，并完整保留本地对话历史。",
    search: "搜索已归档对话或项目",
    open: "打开对话",
    restore: "恢复到任务",
    delete: "删除对话",
    empty: "没有符合条件的已归档对话。",
    goal: "目标",
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
        return `${visibleThreadTitle(thread.title)} ${thread.goal ?? ""} ${projectNames.get(thread.projectId) ?? ""}`
          .toLocaleLowerCase(locale)
          .includes(normalized);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [locale, projectNames, query, threads]);

  return (
    <div className="library-page archive-page">
      <header className="library-hero">
        <span className="library-hero-icon">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7.5h16v11H4zM3.5 4.5h17v3h-17zM9 11h6" />
          </svg>
        </span>
        <div>
          <small>{t.eyebrow}</small>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
        </div>
      </header>

      <label className="library-search">
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
            <div className="archive-card-heading">
              <span className="archive-project">
                {projectNames.get(thread.projectId) ?? "Artemis"}
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
            <div className="archive-card-actions">
              <button
                className="library-primary"
                onClick={() => onOpen(thread)}
              >
                {t.open}
              </button>
              <button
                className="library-secondary"
                onClick={() => onRestore(thread)}
              >
                {t.restore}
              </button>
              <button
                className="library-secondary danger"
                onClick={() => onDelete(thread)}
              >
                {t.delete}
              </button>
            </div>
          </article>
        ))}
        {results.length === 0 && <div className="library-empty">{t.empty}</div>}
      </div>
    </div>
  );
}
