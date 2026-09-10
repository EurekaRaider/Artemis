import { isAttachmentReference, attachmentIsImage } from "@artemis/protocol";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type AppLocale,
  type ChildAgentState,
  type McpToolUsageState,
  type PromptAttachment,
  type TaskSourceState,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import {
  SourceEntry,
  SourceEntryBody,
  SourceEntryButton,
  SourceEntryIcon,
  SourcesScroll,
  SourcesState,
  SourcesSurface,
} from "@artemis/ui/workflow";

import type { WorkspaceFileLink } from "../shared/api.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";
import { type McpGroup, groupMcpUsage } from "./EnvironmentPanel.js";

const labels = {
  en: {
    title: "Sources",
    attachments: "Attachments",
    agents: "Agents",
    task: "This task",
    viewAgent: "View details",
    viewFile: "Open file",
    web: "Web",
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
    previewUnavailable:
      "This image is missing or cannot be read. Attach it again to preview it.",
    imageUnavailable: "Image unavailable",
    showDetails: "Show tool call details",
    hideDetails: "Hide tool call details",
  },
  "zh-CN": {
    title: "来源",
    attachments: "附件",
    agents: "Agent",
    task: "本次任务",
    viewAgent: "查看详情",
    viewFile: "查看文件",
    web: "网页",
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
    previewUnavailable: "图片已丢失或无法读取，请重新附加图片后预览。",
    imageUnavailable: "图片不可用",
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
  return <ArtemisIcon name="source" />;
}

function WebIcon() {
  return <ArtemisIcon name="web" />;
}

function AttachmentIcon({ image }: { image: boolean }) {
  return <ArtemisIcon name={image ? "image" : "file"} />;
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
    <SourceEntry>
      <SourceEntryIcon className="web">
        <WebIcon />
      </SourceEntryIcon>
      <SourceEntryBody>
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
      </SourceEntryBody>
    </SourceEntry>
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
    <SourceEntry className="sources-panel-mcp-entry">
      <SourceEntryBody>
        <button
          className="sources-panel-mcp-summary"
          aria-label={expanded ? copy.hideDetails : copy.showDetails}
          aria-controls={detailsId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <strong title={group.name}>{group.name}</strong>
          <span>{copy.mcpSummary(group.calls, group.tools.length)}</span>
          <ArtemisIcon
            aria-hidden="true"
            name="chevron"
            width={12}
            height={12}
          />
        </button>
        <div
          className="sources-panel-mcp-details"
          hidden={!expanded}
          id={detailsId}
        >
          <p>{usedBy}</p>
          {toolStats.map((entry) => (
            <p key={entry.tool} title={entry.tool}>
              <strong>{entry.tool}</strong>
              <span> · {entry.calls}</span>
            </p>
          ))}
        </div>
      </SourceEntryBody>
    </SourceEntry>
  );
}

export function SourcesPanel({
  agents,
  attachments,
  locale,
  mcpUsages,
  onOpenUrl,
  onOpenAgent,
  onOpenFile,
  sources,
  threadId,
}: {
  agents: ChildAgentState[];
  attachments: PromptAttachment[];
  locale: AppLocale;
  mcpUsages: McpToolUsageState[];
  onOpenUrl: (url: string) => void;
  onOpenAgent?: (agent: ChildAgentState) => void;
  onOpenFile?: (file: WorkspaceFileLink) => void;
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
  const [workspaceFiles, setWorkspaceFiles] = useState<
    Record<string, WorkspaceFileLink>
  >({});
  useEffect(() => {
    let cancelled = false;
    setWorkspaceFiles({});
    if (!onOpenFile) return;
    const names = [
      ...new Set([
        ...attachments
          .filter((attachment) => "type" in attachment)
          .map((attachment) => attachment.name),
        ...attachmentSources
          .filter((source) => source.kind === "file")
          .map((source) => source.name),
      ]),
    ];
    void Promise.all(
      names.map(async (name) => {
        try {
          return [
            name,
            await window.artemis.inspectWorkspaceFileLink(threadId, name),
          ] as const;
        } catch {
          return undefined;
        }
      }),
    ).then((files) => {
      if (!cancelled)
        setWorkspaceFiles(
          Object.fromEntries(files.filter((file) => file !== undefined)),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, attachmentSources, onOpenFile, threadId]);
  const fileAction = (name: string) => {
    const file = workspaceFiles[name];
    return file && onOpenFile ? (
      <button
        className="sources-file-action environment-text-action"
        onClick={() => onOpenFile(file)}
        type="button"
      >
        {t.viewFile}
      </button>
    ) : null;
  };
  const [sourceImages, setSourceImages] = useState<
    Record<string, Extract<PromptAttachment, { data: string }>>
  >({});
  const [preview, setPreview] = useState<
    Extract<PromptAttachment, { data: string }> | undefined
  >();
  const [previewError, setPreviewError] = useState<string>();
  const closePreviewButton = useRef<HTMLButtonElement>(null);
  const imageRequest = useRef(0);
  const [unavailableImages, setUnavailableImages] = useState<Set<string>>(
    new Set(),
  );
  const markUnavailable = (key: string) => {
    setUnavailableImages((current) => new Set(current).add(key));
  };

  useEffect(() => {
    setPreview(undefined);
    setPreviewError(undefined);
    setUnavailableImages(new Set());
    return () => {
      imageRequest.current += 1;
    };
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    setSourceImages({});
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
          if (!cancelled) markUnavailable(source.sourceId);
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
    const request = imageRequest.current;
    try {
      const image =
        sourceImages[source.sourceId] ??
        (await window.artemis.readTaskSourceImage(threadId, source.sourceId));
      if (request !== imageRequest.current) return;
      setSourceImages((current) => ({
        ...current,
        [source.sourceId]: image,
      }));
      setUnavailableImages((current) => {
        const next = new Set(current);
        next.delete(source.sourceId);
        return next;
      });
      setPreview(image);
    } catch {
      if (request !== imageRequest.current) return;
      markUnavailable(source.sourceId);
      setPreviewError(t.previewUnavailable);
    }
  };
  const empty =
    attachments.length === 0 &&
    attachmentSources.length === 0 &&
    mcpGroups.length === 0 &&
    webGroups.length === 0 &&
    agents.length === 0;

  return (
    <SourcesSurface
      label={t.title}
      state={
        previewError ? "error" : preview ? "open" : empty ? "empty" : "ready"
      }
    >
      <header className="workspace-panel-toolbar">
        <strong>{t.title}</strong>
        <span className="workspace-panel-status">{t.task}</span>
      </header>
      <SourcesScroll>
        {empty && <SourcesState state="empty">{t.empty}</SourcesState>}

        {(attachments.length > 0 || attachmentSources.length > 0) && (
          <h2 className="workspace-panel-section-title">
            {t.attachments} · {attachments.length + attachmentSources.length}
          </h2>
        )}
        {attachments.map((attachment, index) => {
          const image = attachmentIsImage(attachment);
          const imageKey = `draft:${index}:${attachment.name}`;
          const unavailable = unavailableImages.has(imageKey);
          const content = (
            <>
              {image && !unavailable ? (
                <img
                  alt=""
                  onError={() => markUnavailable(imageKey)}
                  src={
                    isAttachmentReference(attachment)
                      ? attachment.thumbnail
                      : !("type" in attachment)
                        ? `data:${attachment.mimeType};base64,${attachment.data}`
                        : undefined
                  }
                />
              ) : (
                <SourceEntryIcon>
                  <AttachmentIcon image={image} />
                </SourceEntryIcon>
              )}
              <SourceEntryBody>
                <h2>{attachment.name}</h2>
                <p>{attachment.mimeType}</p>
                <p>{unavailable ? t.imageUnavailable : t.draft}</p>
              </SourceEntryBody>
            </>
          );
          return image ? (
            <SourceEntryButton
              className="attachment"
              key={`draft:${index}:${attachment.name}`}
              label={`${t.openImage}: ${attachment.name}`}
              onClick={() => {
                setPreviewError(undefined);
                if (!("type" in attachment)) setPreview(attachment);
                else if (isAttachmentReference(attachment))
                  void window.artemis
                    .previewPromptAttachment(attachment.id)
                    .then(setPreview)
                    .catch(() => setPreviewError(t.previewUnavailable));
              }}
            >
              {content}
            </SourceEntryButton>
          ) : (
            <SourceEntry
              className="attachment"
              key={`draft:${index}:${attachment.name}`}
            >
              {content}
              {fileAction(attachment.name)}
            </SourceEntry>
          );
        })}

        {attachmentSources.map((source) => {
          const image = sourceImages[source.sourceId];
          const unavailable = unavailableImages.has(source.sourceId);
          const content = (
            <>
              {image && !unavailable ? (
                <img
                  alt=""
                  onError={() => markUnavailable(source.sourceId)}
                  src={`data:${image.mimeType};base64,${image.data}`}
                />
              ) : (
                <SourceEntryIcon>
                  <AttachmentIcon image={source.kind === "image"} />
                </SourceEntryIcon>
              )}
              <SourceEntryBody>
                <h2>{source.name}</h2>
                <p>{source.mimeType}</p>
                <p>{unavailable ? t.imageUnavailable : t.sent}</p>
              </SourceEntryBody>
            </>
          );
          return source.kind === "image" ? (
            <SourceEntryButton
              className="attachment"
              key={source.sourceId}
              label={`${t.openImage}: ${source.name}`}
              onClick={() => void openPersistedImage(source)}
            >
              {content}
            </SourceEntryButton>
          ) : (
            <SourceEntry className="attachment" key={source.sourceId}>
              {content}
              {fileAction(source.name)}
            </SourceEntry>
          );
        })}

        {previewError && (
          <SourcesState state="error">{previewError}</SourcesState>
        )}

        {mcpGroups.length > 0 && (
          <h2 className="workspace-panel-section-title">
            MCP · {mcpGroups.length}
          </h2>
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

        {webGroups.length > 0 && (
          <h2 className="workspace-panel-section-title">
            {t.web} · {webGroups.length}
          </h2>
        )}
        {webGroups.map((group) => (
          <WebSearchSourceGroupView
            copy={t}
            group={group}
            key={`web:${group.id}`}
            onOpenUrl={onOpenUrl}
          />
        ))}
        {agents.length > 0 && (
          <section className="sources-agent-group">
            <h2 className="workspace-panel-section-title">
              {t.agents} · {agents.length}
            </h2>
            {agents.map((agent) => (
              <div className="sources-agent-row" key={agent.agentId}>
                <div>
                  <strong>{agent.label}</strong>
                  <p>{agent.task}</p>
                </div>
                {onOpenAgent && (
                  <button
                    className="environment-text-action"
                    onClick={() => onOpenAgent(agent)}
                    type="button"
                  >
                    {t.viewAgent}
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </SourcesScroll>
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
              onError={() => {
                setPreview(undefined);
                setPreviewError(t.previewUnavailable);
              }}
              src={`data:${preview.mimeType};base64,${preview.data}`}
            />
          </section>
        </div>
      )}
    </SourcesSurface>
  );
}
