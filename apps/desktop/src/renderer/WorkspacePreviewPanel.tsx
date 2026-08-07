import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { WorkspaceTextFile } from "../shared/api.js";
import {
  BROWSER_SESSION_PARTITION,
  shouldReloadBrowserForLocaleChange,
  type BrowserLocale,
} from "../shared/browser-locale.js";
import { normalizeBrowserAddress } from "./browser-navigation.js";
import { MarkdownContent } from "./MarkdownContent.js";

interface WorkspacePreviewProps {
  threadId: string | undefined;
  path: string | undefined;
  revision: string | undefined;
  title: string;
  emptyMessage: string;
  refreshLabel: string;
}

interface MarkdownReaderProps extends WorkspacePreviewProps {
  editLabel: string;
  richLabel: string;
  saveLabel: string;
  savedLabel: string;
  savingLabel: string;
  sourceLabel: string;
  unsavedLabel: string;
}

interface BrowserPanelProps extends WorkspacePreviewProps {
  addressPlaceholder: string;
  backLabel: string;
  forwardLabel: string;
  goLabel: string;
  locale: BrowserLocale;
}

function useWorkspaceTextFile({
  threadId,
  path,
  revision,
}: Pick<WorkspacePreviewProps, "threadId" | "path" | "revision">) {
  const [reload, setReload] = useState(0);
  const [file, setFile] = useState<WorkspaceTextFile>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!threadId || !path) {
      setFile(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(undefined);
    void window.artemis
      .readWorkspaceTextFile(threadId, path)
      .then((value) => {
        if (active) setFile(value);
      })
      .catch((reason) => {
        if (!active) return;
        setFile(undefined);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [path, reload, revision, threadId]);

  return {
    error,
    file,
    loading,
    refresh: () => setReload((value) => value + 1),
    replaceFile: setFile,
  };
}

export function WorkspaceBrowserPanel(props: BrowserPanelProps) {
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const previousLocaleRef = useRef(props.locale);
  const workspaceDocumentRef = useRef<
    { label: string; url: string } | undefined
  >(undefined);
  const [address, setAddress] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [navigationError, setNavigationError] = useState<string>();
  const [pageLoading, setPageLoading] = useState(false);
  const { error, file, loading, refresh } = useWorkspaceTextFile(props);
  const workspaceDocument = useMemo(
    () =>
      file?.kind === "html"
        ? {
            label: file.path,
            url: `data:text/html;charset=utf-8,${encodeURIComponent(file.content)}`,
          }
        : undefined,
    [file],
  );
  const browserSource = workspaceDocument?.url ?? "about:blank";

  workspaceDocumentRef.current = workspaceDocument;

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncNavigation = (url = webview.getURL()) => {
      const workspace = workspaceDocumentRef.current;
      setAddress(
        workspace?.url === url
          ? workspace.label
          : url === "about:blank"
            ? ""
            : url,
      );
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };
    const handleNavigate = (event: Electron.DidNavigateEvent) => {
      setNavigationError(undefined);
      syncNavigation(event.url);
    };
    const handleNavigateInPage = (event: Electron.DidNavigateInPageEvent) => {
      if (event.isMainFrame) syncNavigation(event.url);
    };
    const handleStartLoading = () => setPageLoading(true);
    const handleStopLoading = () => {
      setPageLoading(false);
      syncNavigation();
    };
    const handleFailedLoad = (event: Electron.DidFailLoadEvent) => {
      if (event.errorCode !== -3) {
        setNavigationError(event.errorDescription);
      }
    };

    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigateInPage);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-fail-load", handleFailedLoad);
    return () => {
      webview.removeEventListener("did-navigate", handleNavigate);
      webview.removeEventListener("did-navigate-in-page", handleNavigateInPage);
      webview.removeEventListener("did-start-loading", handleStartLoading);
      webview.removeEventListener("did-stop-loading", handleStopLoading);
      webview.removeEventListener("did-fail-load", handleFailedLoad);
    };
  }, []);

  useEffect(() => {
    if (workspaceDocument) {
      setAddress(workspaceDocument.label);
      setNavigationError(undefined);
    }
  }, [workspaceDocument]);

  useEffect(() => {
    const previousLocale = previousLocaleRef.current;
    previousLocaleRef.current = props.locale;

    const webview = webviewRef.current;
    if (
      !webview ||
      !shouldReloadBrowserForLocaleChange(
        previousLocale,
        props.locale,
        webview.getURL(),
      )
    ) {
      return;
    }
    setNavigationError(undefined);
    webview.reloadIgnoringCache();
  }, [props.locale]);

  const navigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      const url = normalizeBrowserAddress(address);
      setNavigationError(undefined);
      void webview.loadURL(url).catch((reason) => {
        setNavigationError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });
    } catch (reason) {
      setNavigationError(
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  };

  const reload = () => {
    refresh();
    webviewRef.current?.reload();
  };

  return (
    <section className="browser-panel">
      <div className="browser-toolbar">
        <div className="browser-navigation-actions">
          <button
            aria-label={props.backLabel}
            disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack()}
            title={props.backLabel}
          >
            ←
          </button>
          <button
            aria-label={props.forwardLabel}
            disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()}
            title={props.forwardLabel}
          >
            →
          </button>
          <button
            aria-label={props.refreshLabel}
            disabled={pageLoading && loading}
            onClick={reload}
            title={props.refreshLabel}
          >
            ↻
          </button>
        </div>
        <form className="browser-address-form" onSubmit={navigate}>
          <input
            aria-label={props.addressPlaceholder}
            className="browser-address-input"
            onChange={(event) => setAddress(event.target.value)}
            placeholder={props.addressPlaceholder}
            spellCheck={false}
            value={address}
          />
          <button className="browser-go-button" type="submit">
            {props.goLabel}
          </button>
        </form>
      </div>
      {(error || navigationError) && (
        <div className="browser-error">{error ?? navigationError}</div>
      )}
      <webview
        className="browser-frame"
        partition={BROWSER_SESSION_PARTITION}
        ref={webviewRef}
        src={browserSource}
        title={`${props.title}: ${file?.path ?? ""}`}
      />
    </section>
  );
}

export function MarkdownReaderPanel(props: MarkdownReaderProps) {
  const [view, setView] = useState<"rich" | "source">("rich");
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [saveError, setSaveError] = useState<string>();
  const { error, file, loading, refresh, replaceFile } =
    useWorkspaceTextFile(props);
  const content = file?.kind === "markdown" ? file.content : undefined;
  const dirty = content !== undefined && draft !== content;
  const resolveImage = useCallback(
    async (href: string) => {
      if (!props.threadId || !file || file.kind !== "markdown") {
        return undefined;
      }
      const image = await window.artemis.readWorkspaceImage(
        props.threadId,
        file.path,
        href,
      );
      return `data:${image.mimeType};base64,${image.data}`;
    },
    [file, props.threadId],
  );

  useEffect(() => {
    if (content === undefined) return;
    setDraft(content);
    setSaveState("idle");
    setSaveError(undefined);
  }, [content, file?.path]);

  const saveMarkdown = () => {
    if (
      !props.threadId ||
      !file ||
      file.kind !== "markdown" ||
      !dirty ||
      saveState === "saving"
    ) {
      return;
    }
    setSaveState("saving");
    setSaveError(undefined);
    void window.artemis
      .writeWorkspaceFile(props.threadId, file.path, draft)
      .then((saved) => {
        replaceFile({ ...file, content: saved.content ?? draft });
        setSaveState("saved");
      })
      .catch((reason) => {
        setSaveState("idle");
        setSaveError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  return (
    <section className="markdown-reader-panel">
      <div className="preview-panel-header">
        <strong className="preview-file-path" title={file?.path ?? props.path}>
          {file?.path ?? props.title}
        </strong>
        <div className="markdown-reader-actions">
          <div
            aria-label={props.title}
            className="markdown-reader-mode-toggle"
            role="group"
          >
            <button
              aria-pressed={view === "rich"}
              onClick={() => setView("rich")}
            >
              {props.richLabel}
            </button>
            <button
              aria-pressed={view === "source"}
              onClick={() => setView("source")}
            >
              {props.sourceLabel}
            </button>
          </div>
          <button
            className="text-button"
            disabled={!props.path || loading}
            onClick={refresh}
          >
            {props.refreshLabel}
          </button>
          <span
            className={
              dirty
                ? "markdown-reader-save-state dirty"
                : "markdown-reader-save-state"
            }
          >
            {saveState === "saving"
              ? props.savingLabel
              : dirty
                ? props.unsavedLabel
                : saveState === "saved"
                  ? props.savedLabel
                  : ""}
          </span>
          <button
            className="markdown-reader-save"
            disabled={!dirty || saveState === "saving"}
            onClick={saveMarkdown}
          >
            {props.saveLabel}
          </button>
        </div>
      </div>
      {saveError && (
        <div className="workspace-file-editor-error">{saveError}</div>
      )}
      {content === undefined ? (
        <div className={error ? "preview-empty error" : "preview-empty"}>
          {error ?? (loading ? "…" : props.emptyMessage)}
        </div>
      ) : view === "rich" ? (
        <MarkdownContent
          className="markdown-reader-content"
          resolveImage={resolveImage}
          text={draft}
        />
      ) : (
        <textarea
          aria-label={`${props.editLabel}: ${file?.path ?? props.path ?? props.title}`}
          className="markdown-reader-source"
          onChange={(event) => {
            setDraft(event.target.value);
            setSaveState("idle");
          }}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              saveMarkdown();
            }
          }}
          spellCheck={false}
          value={draft}
        />
      )}
    </section>
  );
}
