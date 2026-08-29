import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type AppLocale,
  type ChildAgentState,
  type McpToolUsageState,
  type PromptAttachment,
  type TaskSourceState,
} from "@artemis/protocol";

import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";
import { type McpGroup, groupMcpUsage } from "./EnvironmentPanel.js";

const labels = {
  en: {
    title: "Sources",
    empty: "No sources have been added to this task.",
    draft: "Attached to the next message",
    sent: "Added to the task",
    parentAgent: "Parent agent",
    usedBy: "Used by",
    mcpSummary: (calls: number, tools: number) =>
      `${calls} ${calls === 1 ? "call" : "calls"} · ${tools} ${tools === 1 ? "tool" : "tools"}`,
    searchSummary: (searches: number, results: number) =>
      `${searches} ${searches === 1 ? "search" : "searches"} · ${results} ${results === 1 ? "web result" : "web results"}`,
    searchQuery: "Search query",
    openSource: "Open source",
    openImage: "Open image",
    closeImage: "Close image preview",
    previewUnavailable: "This image preview is unavailable.",
    showDetails: "Show tool call details",
    hideDetails: "Hide tool call details",
  },
  "zh-CN": {
    title: "来源",
    empty: "当前任务尚未添加来源。",
    draft: "已附加到下一条消息",
    sent: "已添加到任务",
    parentAgent: "父 Agent",
    usedBy: "使用 Agent",
    mcpSummary: (calls: number, tools: number) =>
      `${calls} 次调用 · ${tools} 个工具`,
    searchSummary: (searches: number, results: number) =>
      `${searches} 次搜索 · ${results} 个网页结果`,
    searchQuery: "搜索内容",
    openSource: "打开来源",
    openImage: "打开图片",
    closeImage: "关闭图片预览",
    previewUnavailable: "此图片预览不可用。",
    showDetails: "显示工具调用详情",
    hideDetails: "隐藏工具调用详情",
  },
} satisfies Record<"en" | "zh-CN", Record<string, unknown>>;

interface WebSearchSource {
  engine: string;
  kind: "web-search";
  links: Array<{ title: string; url: string }>;
  query: string;
  resultCount: number;
  searchUrl: string;
  sourceId: string;
  timestamp: string;
  turnId?: string;
  type: "task.source.added";
}

interface AttachmentSource {
  kind: "file" | "image";
  mimeType: string;
  name: string;
  sourceId: string;
  timestamp: string;
  turnId?: string;
  type: "task.source.added";
}

interface MutableWebSearchSourceGroup {
  engine: string;
  links: Map<string, { title: string; url: string }>;
  resultCount: number;
  searches: WebSearchSource[];
}

export interface WebSearchSourceGroup {
  engine: string;
  id: string;
  links: Array<{ title: string; url: string }>;
  resultCount: number;
  searches: WebSearchSource[];
}

export function groupWebSearchSources(
  sources: readonly TaskSourceState[],
): WebSearchSourceGroup[] {
  const groups = new Map<string, MutableWebSearchSourceGroup>();
  for (const source of sources) {
    if (source.kind !== "web-search") continue;
    const group: MutableWebSearchSourceGroup = groups.get(source.engine) ?? {
      engine: source.engine,
      links: new Map(),
      resultCount: 0,
      searches: [],
    };
    group.searches.push(source);
    group.resultCount += source.resultCount;
    for (const link of source.links) {
      if (!group.links.has(link.url)) group.links.set(link.url, link);
    }
    groups.set(source.engine, group);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    engine: group.engine,
    links: [...group.links.values()],
    resultCount: group.resultCount,
    searches: group.searches,
  }));
}

export function sourceLinkHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function SourcesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="m8 11 8-4m-8 6 8 4" />
    </svg>
  );
}

function WebIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.5 2.2 3.7 4.8 3.7 8s-1.2 5.8-3.7 8c-2.5-2.2-3.7-4.8-3.7-8S9.5 6.2 12 4Z" />
    </svg>
  );
}

function AttachmentIcon({ image }: { image: boolean }) {
  return image ? (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect height="16" rx="3" width="18" x="3" y="4" />
      <circle cx="9" cy="10" r="2" />
      <path d="m5 18 5-5 3 3 2-2 4 4" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 3h8l4 4v14H6zM14 3v5h4" />
    </svg>
  );
}

function SourceCard({
  host,
  onOpen,
  openLabel,
  title,
  url,
}: {
  host: string;
  onOpen: (url: string) => void;
  openLabel: string;
  title: string;
  url: string;
}) {
  return (
    <button
      aria-label={`${openLabel}: ${title}`}
      onClick={() => onOpen(url)}
      title={url}
      type="button"
    >
      <strong>{title}</strong>
      <span>{host}</span>
    </button>
  );
}

function WebSearchSourceGroupView({
  copy,
  group,
  onOpenUrl,
}: {
  copy: (typeof labels)["en"];
  group: WebSearchSourceGroup;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <article className="sources-panel-entry">
      <span className="sources-panel-icon web">
        <WebIcon />
      </span>
      <div className="sources-panel-entry-body">
        <h2 title={group.engine}>{group.engine}</h2>
        <p>{copy.searchSummary(group.searches.length, group.resultCount)}</p>
        <div className="sources-panel-queries">
          {group.searches.map((search) => (
            <button
              aria-label={`${copy.searchQuery}: ${search.query}`}
              key={search.sourceId}
              onClick={() => onOpenUrl(search.searchUrl)}
              title={search.searchUrl}
              type="button"
            >
              <span>{copy.searchQuery}</span>
              <strong>{search.query}</strong>
            </button>
          ))}
        </div>
        {group.links.length > 0 && (
          <div className="sources-panel-links">
            {group.links.map((link) => (
              <SourceCard
                host={sourceLinkHost(link.url)}
                key={link.url}
                onOpen={onOpenUrl}
                openLabel={copy.openSource}
                title={link.title}
                url={link.url}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function McpUsageGroupView({
  copy,
  group,
  toolStats,
  usedBy,
}: {
  copy: (typeof labels)["en"];
  group: McpGroup;
  toolStats: Array<{ calls: number; tool: string }>;
  usedBy: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <article className="sources-panel-entry">
      <span className="sources-panel-icon">
        <SourcesIcon />
      </span>
      <div className="sources-panel-entry-body">
        <h2 title={group.name}>{group.name}</h2>
        <p>{copy.mcpSummary(group.calls, group.tools.length)}</p>
        <p title={group.tools.join(", ")}>{group.tools.join(", ")}</p>
        <p>{usedBy}</p>
        <button
          aria-controls={detailsId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? copy.hideDetails : copy.showDetails}
        </button>
        {expanded && (
          <div className="sources-panel-mcp-details" id={detailsId}>
            {toolStats.map((entry) => (
              <p key={entry.tool} title={entry.tool}>
                <strong>{entry.tool}</strong>
                <span> · {entry.calls}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function SourcesPanel({
  agents,
  attachments,
  locale,
  mcpUsages,
  onOpenUrl,
  sources,
  threadId,
}: {
  agents: ChildAgentState[];
  attachments: PromptAttachment[];
  locale: AppLocale;
  mcpUsages: McpToolUsageState[];
  onOpenUrl: (url: string) => void;
  sources: TaskSourceState[];
  threadId: string;
}) {
  const t = localizedCopy(locale, "app", labels[legacyLocale(locale)]);
  const mcpGroups = useMemo(() => groupMcpUsage(mcpUsages), [mcpUsages]);
  const mcpToolStats = useMemo(() => {
    const stats = new Map<string, Map<string, number>>();
    for (const usage of mcpUsages) {
      const byServer = stats.get(usage.serverId) ?? new Map<string, number>();
      byServer.set(usage.toolName, (byServer.get(usage.toolName) ?? 0) + 1);
      stats.set(usage.serverId, byServer);
    }
    return stats;
  }, [mcpUsages]);
  const webGroups = useMemo(() => groupWebSearchSources(sources), [sources]);
  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent.label])),
    [agents],
  );
  const attachmentSources = useMemo(
    () =>
      sources.filter(
        (source): source is AttachmentSource =>
          source.kind === "file" || source.kind === "image",
      ),
    [sources],
  );
  const [sourceImages, setSourceImages] = useState<
    Record<string, Extract<PromptAttachment, { data: string }>>
  >({});
  const [preview, setPreview] = useState<
    Extract<PromptAttachment, { data: string }> | undefined
  >();
  const [previewError, setPreviewError] = useState<string>();
  const closePreviewButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const imageSources = attachmentSources.filter(
      (source) => source.kind === "image",
    );
    void Promise.all(
      imageSources.map(async (source) => {
        try {
          return [
            source.sourceId,
            await window.artemis.readTaskSourceImage(threadId, source.sourceId),
          ] as const;
        } catch {
          return undefined;
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      setSourceImages(
        Object.fromEntries(loaded.filter((entry) => entry !== undefined)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentSources, threadId]);

  useEffect(() => {
    if (!preview) return;
    closePreviewButton.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  const openPersistedImage = async (source: AttachmentSource) => {
    setPreviewError(undefined);
    try {
      const image =
        sourceImages[source.sourceId] ??
        (await window.artemis.readTaskSourceImage(threadId, source.sourceId));
      setSourceImages((current) => ({
        ...current,
        [source.sourceId]: image,
      }));
      setPreview(image);
    } catch {
      setPreviewError(t.previewUnavailable);
    }
  };
  const empty =
    attachments.length === 0 &&
    attachmentSources.length === 0 &&
    mcpGroups.length === 0 &&
    webGroups.length === 0;

  return (
    <section aria-label={t.title} className="sources-panel">
      <div className="sources-panel-scroll">
        {empty && <p className="sources-panel-empty">{t.empty}</p>}

        {attachments.map((attachment, index) => {
          const image = !("type" in attachment);
          const Tag = image ? "button" : "article";
          return (
            <Tag
              {...(image
                ? {
                    "aria-label": `${t.openImage}: ${attachment.name}`,
                    onClick: () => {
                      setPreviewError(undefined);
                      setPreview(attachment);
                    },
                    type: "button" as const,
                  }
                : {})}
              className="sources-panel-entry attachment"
              key={`draft:${index}:${attachment.name}`}
            >
              {image ? (
                <img
                  alt=""
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
              ) : (
                <span className="sources-panel-icon">
                  <AttachmentIcon image={false} />
                </span>
              )}
              <div className="sources-panel-entry-body">
                <h2>{attachment.name}</h2>
                <p>{attachment.mimeType}</p>
                <p>{t.draft}</p>
              </div>
            </Tag>
          );
        })}

        {attachmentSources.map((source) => {
          const image = sourceImages[source.sourceId];
          const Tag = source.kind === "image" ? "button" : "article";
          return (
            <Tag
              {...(source.kind === "image"
                ? {
                    "aria-label": `${t.openImage}: ${source.name}`,
                    onClick: () => void openPersistedImage(source),
                    type: "button" as const,
                  }
                : {})}
              className="sources-panel-entry attachment"
              key={source.sourceId}
            >
              {image ? (
                <img
                  alt=""
                  src={`data:${image.mimeType};base64,${image.data}`}
                />
              ) : (
                <span className="sources-panel-icon">
                  <AttachmentIcon image={source.kind === "image"} />
                </span>
              )}
              <div className="sources-panel-entry-body">
                <h2>{source.name}</h2>
                <p>{source.mimeType}</p>
                <p>{t.sent}</p>
              </div>
            </Tag>
          );
        })}

        {previewError && (
          <p className="sources-panel-preview-error" role="alert">
            {previewError}
          </p>
        )}

        {mcpGroups.map((group) => (
          <McpUsageGroupView
            copy={t}
            group={group}
            key={`mcp:${group.id}`}
            toolStats={[...(mcpToolStats.get(group.id)?.entries() ?? [])]
              .map(([tool, calls]) => ({ calls, tool }))
              .sort(
                (a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool),
              )}
            usedBy={`${t.usedBy} · ${group.agents
              .map(
                (agentId) =>
                  agentNames.get(agentId) ??
                  (agentId === "parent" ? t.parentAgent : agentId),
              )
              .join(", ")}`}
          />
        ))}

        {webGroups.map((group) => (
          <WebSearchSourceGroupView
            copy={t}
            group={group}
            key={`web:${group.id}`}
            onOpenUrl={onOpenUrl}
          />
        ))}
      </div>
      {preview && (
        <div
          className="source-image-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(undefined);
          }}
        >
          <section
            aria-label={`${t.openImage}: ${preview.name}`}
            aria-modal="true"
            className="source-image-preview"
            role="dialog"
          >
            <header>
              <h2>{preview.name}</h2>
              <button
                aria-label={t.closeImage}
                onClick={() => setPreview(undefined)}
                ref={closePreviewButton}
                type="button"
              >
                ×
              </button>
            </header>
            <img
              alt={preview.name}
              src={`data:${preview.mimeType};base64,${preview.data}`}
            />
          </section>
        </div>
      )}
    </section>
  );
}
