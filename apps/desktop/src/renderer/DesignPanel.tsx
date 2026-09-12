import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignPanelAction,
  DesignPanelState,
  DesignPatch,
  DesignRevision,
  RunMode,
  PromptAttachment,
} from "@artemis/protocol";
import "./design-panel.css";
import { confirmDesignLeave } from "./design-drafts.js";

export function DesignPanel({
  threadId,
  mode,
  active,
  onConversation,
}: {
  threadId: string | undefined;
  mode: RunMode;
  active: boolean;
  onConversation: (text: string, image?: PromptAttachment) => void;
}) {
  const [state, setState] = useState<DesignPanelState>();
  const [revision, setRevision] = useState<DesignRevision>();
  const [variantId, setVariantId] = useState("");
  const [pageId, setPageId] = useState("");
  const [patches, setPatches] = useState<DesignPatch[]>([]);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string>();
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [comparison, setComparison] = useState<DesignRevision>();
  const [undone, setUndone] = useState<DesignPatch[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const seenPreview = useRef<string | undefined>(undefined);
  const scope = useRef(threadId);
  scope.current = threadId;
  const variant = revision?.content.variants.find(
    (item) => item.id === variantId,
  );
  const page = variant?.pages.find((item) => item.id === pageId);
  const entries = state?.sources?.[variantId]?.[pageId] ?? [];
  const selected = entries.find((item) => item.id === selectedId);
  const draftKey =
    threadId && revision
      ? `artemis:design-draft:${threadId}:${revision.revisionId}:${variantId}:${pageId}`
      : undefined;
  const head = state?.documents.find(
    (item) => item.documentId === revision?.documentId,
  );
  const canWrite = mode === "execute" && !busy;
  const restoreSavedPreview =
    patches.length === 0 &&
    state?.preview?.draft === true &&
    state.preview.revisionId === revision?.revisionId;

  const accept = useCallback((next: DesignPanelState) => {
    setState((current) => ({ ...current, ...next }));
    if (next.revision) {
      setRevision(next.revision);
      const first = next.revision.content.variants[0]!;
      setVariantId((current) =>
        next.revision!.content.variants.some((item) => item.id === current)
          ? current
          : first.id,
      );
      setPageId((current) =>
        next.revision!.content.variants.some((item) =>
          item.pages.some((page) => page.id === current),
        )
          ? current
          : first.pages[0]!.id,
      );
    }
  }, []);
  const action = useCallback(
    async (input: DesignPanelAction) => {
      if (!threadId) return;
      if (
        (input.action === "read" || input.action === "workflow") &&
        !(await confirmDesignLeave(threadId))
      )
        return;
      if (scope.current !== threadId) return;
      setBusy(true);
      setError("");
      try {
        const next = await window.artemis.designAction(threadId, input);
        if (scope.current !== threadId) return;
        accept(next);
        return next;
      } catch (error) {
        if (scope.current === threadId) setError(String(error));
      } finally {
        if (scope.current === threadId) setBusy(false);
      }
    },
    [threadId, accept],
  );

  useEffect(() => {
    setBusy(false);
    setState(undefined);
    setRevision(undefined);
    setVariantId("");
    setPageId("");
    setSelectedId("");
    setError("");
    if (!threadId) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await window.artemis.getDesignState(threadId);
        if (!disposed) setState((current) => ({ ...current, ...next }));
      } catch (error) {
        if (!disposed) setError(String(error));
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [threadId]);
  useEffect(() => {
    if (!revision && state?.documents[0])
      void action({
        action: "read",
        documentId: state.documents[0].documentId,
      });
  }, [revision, state?.documents[0]?.documentId, action]);
  useEffect(() => {
    setLoadedDraftKey(draftKey);
    setUndone([]);
    if (!draftKey) {
      setPatches([]);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "[]");
      const restored = Array.isArray(saved) ? saved : saved.patches;
      if (!Array.isArray(restored) || restored.length > 128)
        throw new Error("Invalid draft");
      setPatches(restored);
      setOperationId(
        Array.isArray(saved) ? crypto.randomUUID() : saved.operationId,
      );
    } catch {
      setPatches([]);
    }
  }, [draftKey]);
  useEffect(() => {
    if (!threadId || !draftKey || !revision || loadedDraftKey !== draftKey)
      return;
    void window.artemis
      .setDesignDraft(
        threadId,
        draftKey,
        patches.length
          ? {
              action: "patch",
              operationId,
              documentId: revision.documentId,
              baseRevision: revision.revisionId,
              variantId,
              pageId,
              patches,
            }
          : null,
      )
      .catch((error) => setError(String(error)));
  }, [
    threadId,
    draftKey,
    loadedDraftKey,
    patches,
    operationId,
    revision?.revisionId,
    variantId,
    pageId,
  ]);
  useEffect(() => {
    const clear = (event: Event) => {
      if (
        !(event as CustomEvent).detail ||
        (event as CustomEvent).detail === threadId
      ) {
        setPatches([]);
        setUndone([]);
      }
    };
    window.addEventListener("artemis-design-drafts-cleared", clear);
    return () =>
      window.removeEventListener("artemis-design-drafts-cleared", clear);
  }, [threadId]);
  useEffect(() => {
    if (
      !threadId ||
      !revision ||
      !page ||
      (!patches.length && !restoreSavedPreview) ||
      loadedDraftKey !== draftKey ||
      !active ||
      busy ||
      mode !== "execute"
    )
      return;
    let disposed = false;
    const timer = setTimeout(() => {
      void window.artemis
        .designAction(
          threadId,
          patches.length
            ? {
                action: "draft-preview",
                documentId: revision.documentId,
                baseRevision: revision.revisionId,
                variantId,
                pageId,
                patches,
              }
            : {
                action: "preview",
                documentId: revision.documentId,
                revisionId: revision.revisionId,
                variantId,
                pageId,
              },
        )
        .then((next) => {
          if (!disposed && scope.current === threadId)
            setState((current) => ({ ...current, ...next }));
        })
        .catch((error) => {
          if (!disposed) setError(String(error));
        });
    }, 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [
    threadId,
    revision?.revisionId,
    variantId,
    pageId,
    patches,
    loadedDraftKey,
    draftKey,
    restoreSavedPreview,
    active,
    busy,
    mode,
  ]);
  const replacePatches = (next: DesignPatch[]) => {
    try {
      const id = crypto.randomUUID();
      if (draftKey) {
        if (next.length)
          localStorage.setItem(
            draftKey,
            JSON.stringify({ operationId: id, patches: next }),
          );
        else localStorage.removeItem(draftKey);
      }
      setOperationId(id);
      setPatches(next);
    } catch {
      setError("无法保留草稿，请释放本地存储空间后重试。");
    }
  };
  const edit = (patch: DesignPatch) => {
    const next = [...patches, patch];
    if (next.length > 128) {
      setError("请先保存当前编辑，再继续修改。");
      return;
    }
    replacePatches(next);
    setUndone([]);
  };
  useEffect(() => {
    const preview = state?.preview;
    if (!threadId || !preview) return;
    const update = () => {
      const rect = canvas.current?.getBoundingClientRect();
      if (!rect) return;
      void window.artemis
        .setDesignBounds(
          threadId,
          preview.instanceId,
          { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          active &&
            mode === "execute" &&
            !showSource &&
            preview.status === "running" &&
            preview.revisionId === revision?.revisionId &&
            preview.variantId === variantId &&
            preview.pageId === pageId,
        )
        .catch((error) => setError(String(error)));
    };
    update();
    const observer = new ResizeObserver(update);
    if (canvas.current) observer.observe(canvas.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      void window.artemis
        .setDesignBounds(
          threadId,
          preview.instanceId,
          { x: 0, y: 0, width: 1, height: 1 },
          false,
        )
        .catch(() => {});
    };
  }, [
    threadId,
    state?.preview?.instanceId,
    state?.preview?.status,
    active,
    mode,
    showSource,
    revision?.revisionId,
    variantId,
    pageId,
  ]);
  useEffect(() => {
    const preview = state?.preview;
    if (
      preview &&
      preview.revisionId === revision?.revisionId &&
      preview.variantId === variantId &&
      preview.pageId === pageId &&
      preview.selection
    )
      setSelectedId(preview.selection.elementId);
  }, [
    state?.preview?.selection?.elementId,
    revision?.revisionId,
    variantId,
    pageId,
  ]);

  useEffect(() => {
    const preview = state?.preview;
    if (!preview || seenPreview.current === preview.instanceId) return;
    seenPreview.current = preview.instanceId;
    if (
      preview.revisionId === revision?.revisionId &&
      revision.content.variants
        .find((item) => item.id === preview.variantId)
        ?.pages.some((item) => item.id === preview.pageId)
    ) {
      setVariantId(preview.variantId);
      setPageId(preview.pageId);
    }
  }, [state?.preview?.instanceId, revision?.revisionId]);
  const save = async () => {
    if (!revision || !page || !patches.length) return;
    const key = draftKey;
    const result = await action({
      action: "patch",
      operationId,
      documentId: revision.documentId,
      baseRevision: revision.revisionId,
      variantId,
      pageId,
      patches,
    });
    if (result?.revision) {
      if (key) {
        localStorage.removeItem(key);
        await window.artemis.setDesignDraft(threadId!, key, null);
      }
      setPatches([]);
      setUndone([]);
    }
  };
  const exact =
    revision && page
      ? {
          documentId: revision.documentId,
          revisionId: revision.revisionId,
          variantId,
          pageId,
        }
      : undefined;
  const previewMatches =
    exact &&
    state?.preview?.revisionId === exact.revisionId &&
    state.preview.variantId === variantId &&
    state.preview.pageId === pageId;
  return (
    <section
      className="design-panel"
      aria-label="设计工作区"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "z" &&
          !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)
        ) {
          event.preventDefault();
          if (event.shiftKey && undone.length) {
            replacePatches([...patches, undone[undone.length - 1]!]);
            setUndone(undone.slice(0, -1));
          } else if (!event.shiftKey && patches.length) {
            setUndone([...undone, patches[patches.length - 1]!]);
            replacePatches(patches.slice(0, -1));
          }
        }
      }}
    >
      <header className="design-toolbar">
        <strong>{state?.workflow === "design" ? "设计工作流" : "设计"}</strong>
        <button onClick={() => onConversation("/design ")}>新建设计</button>
        <button
          disabled={busy}
          onClick={() =>
            void action({
              action: "workflow",
              workflow: state?.workflow === "design" ? "code" : "design",
            })
          }
        >
          {state?.workflow === "design" ? "返回代码" : "进入设计"}
        </button>
        <select
          aria-label="设计文档"
          value={revision?.documentId ?? ""}
          onChange={(event) =>
            void action({ action: "read", documentId: event.target.value })
          }
        >
          <option value="" disabled>
            选择设计
          </option>
          {state?.documents.map((item) => (
            <option key={item.documentId} value={item.documentId}>
              {item.title}
            </option>
          ))}
        </select>
        {revision && (
          <select
            aria-label="设计版本"
            value={revision.revisionId}
            onChange={(event) =>
              void action({
                action: "read",
                documentId: revision.documentId,
                revisionId: event.target.value,
              })
            }
          >
            {state?.history?.map((item) => (
              <option key={item.revisionId} value={item.revisionId}>
                {item.revisionId === head?.revisionId
                  ? "最新版本"
                  : item.createdAt.slice(11, 19)}
                {item.conflict ? " · 冲突分支" : ""} ·{" "}
                {item.revisionId.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </header>
      {error && (
        <p className="design-notice" role="alert">
          {error}
        </p>
      )}
      {mode !== "execute" && (
        <p className="design-notice">
          当前模式只允许阅读和讨论。切换到 Execute 后可编辑、运行预览及实施。
        </p>
      )}
      {revision && head && head.revisionId !== revision.revisionId && (
        <p className="design-notice">
          已有其他版本，当前查看的内容和草稿已保留。
          <button
            disabled={busy}
            onClick={() =>
              void action({
                action: "read",
                documentId: head.documentId,
                revisionId: head.revisionId,
              })
            }
          >
            查看最新版本
          </button>
        </p>
      )}
      {revision?.conflict && (
        <p className="design-notice">
          此版本与较新的修改冲突，已独立保留。请比较版本后选择需要继续的内容。
        </p>
      )}
      {(!!patches.length || !!undone.length) && (
        <div className="design-toolbar">
          <button
            disabled={!patches.length}
            onClick={() => {
              setUndone([...undone, patches[patches.length - 1]!]);
              replacePatches(patches.slice(0, -1));
            }}
          >
            撤销
          </button>
          <button
            disabled={!undone.length}
            onClick={() => {
              replacePatches([...patches, undone[undone.length - 1]!]);
              setUndone(undone.slice(0, -1));
            }}
          >
            重做
          </button>
          {!!patches.length && (
            <span>{patches.length} 项未保存编辑 · 草稿已在本机保留</span>
          )}
          <button
            disabled={!canWrite || !patches.length}
            onClick={() => void save()}
          >
            保存新版本
          </button>
          <button
            onClick={() => {
              if (draftKey) localStorage.removeItem(draftKey);
              setPatches([]);
            }}
          >
            丢弃草稿
          </button>
        </div>
      )}
      {!!state?.requests.filter(
        (item) => !["completed", "cancelled"].includes(item.status),
      ).length && (
        <details className="design-queue">
          <summary>任务队列</summary>
          {state.requests
            .filter((item) => !["completed", "cancelled"].includes(item.status))
            .map((item) => (
              <div key={item.requestId}>
                <span>
                  {item.workflow} · {item.status} · {item.text.slice(0, 100)}
                </span>
                {item.error && <p>{item.error}</p>}
                {item.status === "pending" && (
                  <>
                    <button
                      onClick={() => {
                        const ids = state.requests
                          .filter((request) => request.status === "pending")
                          .map((request) => request.requestId);
                        const index = ids.indexOf(item.requestId);
                        if (index > 0) {
                          [ids[index - 1], ids[index]] = [
                            ids[index]!,
                            ids[index - 1]!,
                          ];
                          void action({ action: "reorder", requestIds: ids });
                        }
                      }}
                    >
                      上移
                    </button>
                    {!item.designRef && (
                      <textarea
                        aria-label="编辑排队消息"
                        defaultValue={item.text}
                        onBlur={(event) => {
                          if (event.target.value !== item.text)
                            void action({
                              action: "edit-request",
                              requestId: item.requestId,
                              text: event.target.value,
                            });
                        }}
                      />
                    )}
                  </>
                )}
                {["failed", "paused", "needs-reconciliation"].includes(
                  item.status,
                ) && (
                  <button
                    disabled={!canWrite}
                    onClick={() =>
                      void action({
                        action: "retry",
                        requestId: item.requestId,
                      })
                    }
                  >
                    已核对原任务，重新提交
                  </button>
                )}
                {item.status !== "dispatched" && (
                  <button
                    onClick={() =>
                      void action({
                        action: "cancel",
                        requestId: item.requestId,
                      })
                    }
                  >
                    取消
                  </button>
                )}
              </div>
            ))}
        </details>
      )}
      {revision && page ? (
        <>
          <div className="design-toolbar">
            <select
              aria-label="设计方案"
              value={variantId}
              onChange={async (event) => {
                const id = event.target.value;
                if (!(await confirmDesignLeave(threadId))) return;
                setVariantId(id);
                setPageId(
                  revision.content.variants.find((item) => item.id === id)!
                    .pages[0]!.id,
                );
                setSelectedId("");
              }}
            >
              {revision.content.variants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="设计页面"
              value={pageId}
              onChange={async (event) => {
                const id = event.target.value;
                if (!(await confirmDesignLeave(threadId))) return;
                setPageId(id);
                setSelectedId("");
              }}
            >
              {variant?.pages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              disabled={!canWrite || !!patches.length}
              onClick={() =>
                exact && void action({ action: "preview", ...exact })
              }
            >
              运行预览
            </button>
            <button
              disabled={!canWrite || !!patches.length}
              onClick={() =>
                exact && void action({ action: "inspect", ...exact })
              }
            >
              截图检查
            </button>
            <button onClick={() => void action({ action: "stop" })}>
              停止
            </button>
            <button
              onClick={async () => {
                if (comparison) {
                  setComparison(undefined);
                  return;
                }
                if (!threadId) return;
                try {
                  const next = await window.artemis.designAction(threadId, {
                    action: "read",
                    documentId: revision.documentId,
                  });
                  if (scope.current === threadId) {
                    setComparison(next.revision);
                    setShowSource(true);
                  }
                } catch (error) {
                  setError(String(error));
                }
              }}
            >
              对比最新版本
            </button>
            <button onClick={() => setShowSource((value) => !value)}>
              {showSource ? "画布" : "源码"}
            </button>
            <button
              disabled={
                !canWrite ||
                !previewMatches ||
                state?.preview?.status !== "running" ||
                !!patches.length
              }
              onClick={() =>
                state?.preview &&
                void action({
                  action: "export",
                  instanceId: state.preview.instanceId,
                })
              }
            >
              导出静态 HTML
            </button>
            <button
              disabled={!canWrite || !!patches.length}
              onClick={() =>
                void action({
                  action: "implement",
                  requestId: crypto.randomUUID(),
                  ref: {
                    documentId: revision.documentId,
                    revisionId: revision.revisionId,
                    variantId,
                    pageIds: [pageId],
                  },
                })
              }
            >
              实施此页面
            </button>
            <button
              disabled={!canWrite || !!patches.length}
              onClick={() =>
                void action({
                  action: "implement",
                  requestId: crypto.randomUUID(),
                  ref: {
                    documentId: revision.documentId,
                    revisionId: revision.revisionId,
                    variantId,
                    pageIds: variant!.pages.map((item) => item.id),
                  },
                })
              }
            >
              实施此方案
            </button>
          </div>
          <div className="design-thumbnails" aria-label="方案比较">
            {revision.content.variants.map((item) => {
              const thumbnail = state?.thumbnails?.find(
                (image) => image.variantId === item.id,
              );
              return (
                <button
                  key={item.id}
                  aria-pressed={variantId === item.id}
                  onClick={async () => {
                    if (!(await confirmDesignLeave(threadId))) return;
                    setVariantId(item.id);
                    setPageId(item.pages[0]!.id);
                  }}
                >
                  {thumbnail ? (
                    <img
                      alt={`${item.name} · ${thumbnail.passed ? "检查通过" : "未通过检查"}`}
                      src={thumbnail.dataUrl}
                    />
                  ) : (
                    <span>尚未截图检查</span>
                  )}
                  <strong>{item.name}</strong>
                  <span>{item.description}</span>
                </button>
              );
            })}
          </div>
          <div className="design-body">
            <div className="design-canvas" ref={canvas}>
              {showSource ? (
                <div className="design-source-comparison">
                  <div>
                    <p>当前版本 · {revision.revisionId.slice(0, 8)}</p>
                    <pre>{page.html}</pre>
                  </div>
                  {comparison && (
                    <div>
                      <p>最新版本 · {comparison.revisionId.slice(0, 8)}</p>
                      <pre>
                        {comparison.content.variants
                          .find((item) => item.id === variantId)
                          ?.pages.find((item) => item.id === pageId)?.html ??
                          "此版本中没有对应页面"}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <p>
                  {previewMatches && state?.preview?.status === "running"
                    ? "预览运行中"
                    : "选择运行预览以查看此版本。"}
                  {state?.preview?.error}
                </p>
              )}
            </div>
            <aside className="design-inspector">
              <p>{variant?.description}</p>
              <select
                aria-label="选中元素"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">在预览中点击元素</option>
                {entries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.tag} · {item.id}
                  </option>
                ))}
              </select>
              {selected && (
                <div key={`${revision.revisionId}:${selected.id}`}>
                  <p>
                    源码第 {selected.line} 行 ·{" "}
                    {revision.revisionId.slice(0, 8)}
                  </p>
                  <button
                    onClick={() => {
                      setShowSource(true);
                    }}
                  >
                    查看源码
                  </button>
                  <button
                    onClick={async () => {
                      const context = `请修改设计 ${revision.documentId} 的版本 ${revision.revisionId}，方案 ${variantId}，页面 ${pageId}，元素 ${selected.id}（${selected.tag}，源码第 ${selected.line} 行）：`;
                      const result =
                        previewMatches &&
                        state?.preview?.status === "running" &&
                        !patches.length
                          ? await action({
                              action: "selection-image",
                              instanceId: state.preview.instanceId,
                            })
                          : undefined;
                      if (scope.current === threadId)
                        onConversation(context, result?.selectionImage);
                    }}
                  >
                    通过对话修改
                  </button>
                  {selected.editable && !selected.binding ? (
                    <label>
                      静态文字
                      <textarea
                        disabled={!canWrite}
                        key={`${selected.id}:${patches.length}`}
                        defaultValue={
                          patches
                            .filter(
                              (
                                patch,
                              ): patch is Extract<
                                DesignPatch,
                                { type: "text" }
                              > =>
                                patch.type === "text" &&
                                patch.elementId === selected.id,
                            )
                            .at(-1)?.text ?? selected.text
                        }
                        onBlur={(event) => {
                          if (event.target.value !== selected.text)
                            edit({
                              type: "text",
                              elementId: selected.id,
                              text: event.target.value,
                            });
                        }}
                      />
                    </label>
                  ) : (
                    <p>此元素不支持直接文字编辑，可使用对话修改。</p>
                  )}
                  <label>
                    文字颜色
                    <input
                      type="color"
                      disabled={!canWrite}
                      onChange={(event) =>
                        edit({
                          type: "style",
                          elementId: selected.id,
                          property: "color",
                          value: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    圆角
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      disabled={!canWrite}
                      onBlur={(event) =>
                        event.target.value &&
                        edit({
                          type: "style",
                          elementId: selected.id,
                          property: "border-radius",
                          value: `${event.target.value}px`,
                        })
                      }
                    />
                  </label>
                  {selected.tag === "img" && (
                    <label>
                      替换图片
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={!canWrite}
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          if (file.size > 3 * 1024 * 1024) {
                            setError(
                              "请选择小于 3 MiB 的 PNG、JPEG 或 WebP 图片。",
                            );
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = () =>
                            edit({
                              type: "image",
                              elementId: selected.id,
                              dataUrl: String(reader.result),
                            });
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                  )}
                  <label>
                    移至静态容器
                    <select
                      disabled={!canWrite}
                      value=""
                      onChange={(event) =>
                        edit({
                          type: "move",
                          elementId: selected.id,
                          parentId: event.target.value,
                        })
                      }
                    >
                      <option value="" disabled>
                        选择目标容器
                      </option>
                      {entries
                        .filter(
                          (item) => item.container && item.id !== selected.id,
                        )
                        .map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.id}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              )}
              {!!entries.length && (
                <details>
                  <summary>页面结构 · 拖动排序</summary>
                  <ul>
                    {entries.map((item) => (
                      <li
                        key={item.id}
                        draggable={canWrite && !!item.parentId}
                        onDragStart={(event) =>
                          event.dataTransfer.setData("text/plain", item.id)
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const id = event.dataTransfer.getData("text/plain");
                          if (
                            canWrite &&
                            item.parentId &&
                            entries.some((entry) => entry.id === id)
                          )
                            edit({
                              type: "move",
                              elementId: id,
                              parentId: item.parentId,
                              beforeId: item.id,
                            });
                        }}
                      >
                        <button onClick={() => setSelectedId(item.id)}>
                          {item.tag} · {item.id}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {page.parameters.map((parameter) => (
                <label
                  key={`${revision.revisionId}:${parameter.name}:${patches.length}`}
                >
                  {parameter.name}
                  <input
                    disabled={!canWrite}
                    type={parameter.kind === "color" ? "color" : "number"}
                    {...(parameter.kind !== "color"
                      ? { min: parameter.min, max: parameter.max }
                      : {})}
                    defaultValue={
                      patches
                        .filter(
                          (
                            patch,
                          ): patch is Extract<
                            DesignPatch,
                            { type: "parameter" }
                          > =>
                            patch.type === "parameter" &&
                            patch.name === parameter.name,
                        )
                        .at(-1)?.value ?? parameter.value
                    }
                    onBlur={(event) => {
                      const value =
                        parameter.kind === "color"
                          ? event.target.value
                          : Number(event.target.value);
                      if (value !== parameter.value)
                        edit({
                          type: "parameter",
                          name: parameter.name,
                          value,
                        });
                    }}
                  />
                </label>
              ))}
              {Object.entries(page.data).map(([key, value]) => (
                <label
                  key={`${revision.revisionId}:data:${key}:${patches.length}`}
                >
                  数据 · {key}
                  <input
                    disabled={!canWrite}
                    defaultValue={String(
                      patches
                        .filter(
                          (
                            patch,
                          ): patch is Extract<
                            DesignPatch,
                            { type: "binding" }
                          > => patch.type === "binding" && patch.key === key,
                        )
                        .at(-1)?.value ?? value,
                    )}
                    onBlur={(event) => {
                      const updated =
                        typeof value === "number"
                          ? Number(event.target.value)
                          : typeof value === "boolean"
                            ? event.target.value === "true"
                            : event.target.value;
                      if (updated !== value)
                        edit({ type: "binding", key, value: updated });
                    }}
                  />
                </label>
              ))}
              <details>
                <summary>设计依据和模拟行为</summary>
                <p>{revision.content.brief}</p>
                <p>{revision.content.interactionNotes}</p>
                {revision.content.basis.map((item) => (
                  <p key={item.path}>
                    {item.path}: {item.summary}
                  </p>
                ))}
              </details>
              {!!state?.preview?.errors.length && (
                <details open>
                  <summary>预览错误</summary>
                  {state.preview.errors.map((item, index) => (
                    <p key={index}>{item}</p>
                  ))}
                </details>
              )}
            </aside>
          </div>
        </>
      ) : (
        <div className="design-empty">
          <h3>在当前任务中探索设计</h3>
          <p>
            发送 /design
            和你的需求，生成可交互的方案。预览使用模拟数据，选定版本后可以在当前工作区实施。
          </p>
          <button onClick={() => onConversation("/design ")}>开始设计</button>
        </div>
      )}
    </section>
  );
}
