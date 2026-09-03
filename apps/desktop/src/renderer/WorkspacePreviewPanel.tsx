import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/icons/ArrowClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/icons/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/icons/ArrowRight";
import {
  BrowserAddressForm,
  BrowserAddressInput,
  BrowserGoButton,
  BrowserNavigation,
  BrowserNavigationButton,
  BrowserState,
  BrowserSurface,
  BrowserToolbar,
  BrowserViewport,
} from "@artemis/ui/professional";
import {
  WorkspaceContentState,
  WorkspaceEditorToolbar,
  WorkspacePreview,
  WorkspaceSourceEditor,
} from "@artemis/ui/workspace";

import type { WorkspaceTextFile } from "../shared/api.js";
import {
  BROWSER_SESSION_PARTITION,
  shouldReloadBrowserForLocaleChange,
  type BrowserLocale,
} from "../shared/browser-locale.js";
import { localeDirection } from "../shared/locales.js";
import {
  browserNavigationSnapshot,
  normalizeBrowserAddress,
} from "./browser-navigation.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { handleWorkspaceEditorSaveShortcut } from "./workspace-editor-shortcut.js";

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
  imageFailureMessage: string;
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
  initialUrl?: string | undefined;
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
  const rtl = localeDirection(props.locale) === "rtl";
  const webviewRef = useRef<Electron.WebviewTag>(null);
  const webviewReadyRef = useRef(false);
  const previousLocaleRef = useRef(props.locale);
  const workspaceDocumentRef = useRef<
    { label: string; url: string } | undefined
  >(undefined);
  const [address, setAddress] = useState(props.initialUrl ?? "");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [navigationError, setNavigationError] = useState<string>();
  const [pageLoading, setPageLoading] = useState(false);
  const [webviewReady, setWebviewReady] = useState(false);
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
  const browserSource =
    workspaceDocument?.url ?? props.initialUrl ?? "about:blank";

  workspaceDocumentRef.current = workspaceDocument;

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const syncNavigation = (url?: string) => {
      const navigation = browserNavigationSnapshot(
        webview,
        webviewReadyRef.current,
        url,
      );
      if (!navigation) return;
      const workspace = workspaceDocumentRef.current;
      setAddress(
        workspace?.url === navigation.url
          ? workspace.label
          : navigation.url === "about:blank"
            ? ""
            : navigation.url,
      );
      setCanGoBack(navigation.canGoBack);
      setCanGoForward(navigation.canGoForward);
    };
    const handleDomReady = () => {
      webviewReadyRef.current = true;
      setWebviewReady(true);
      syncNavigation();
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

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-navigate", handleNavigate);
    webview.addEventListener("did-navigate-in-page", handleNavigateInPage);
    webview.addEventListener("did-start-loading", handleStartLoading);
    webview.addEventListener("did-stop-loading", handleStopLoading);
    webview.addEventListener("did-fail-load", handleFailedLoad);
    return () => {
      webviewReadyRef.current = false;
      webview.removeEventListener("dom-ready", handleDomReady);
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
    if (!props.initialUrl) return;
    setAddress(props.initialUrl);
    setNavigationError(undefined);
  }, [props.initialUrl]);

  useEffect(() => {
    const previousLocale = previousLocaleRef.current;
    previousLocaleRef.current = props.locale;

    const webview = webviewRef.current;
    const navigation = webview
      ? browserNavigationSnapshot(webview, webviewReadyRef.current)
      : undefined;
    if (
      !webview ||
      !navigation ||
      !shouldReloadBrowserForLocaleChange(
        previousLocale,
        props.locale,
        navigation.url,
      )
    ) {
      return;
    }
    try {
      webview.reloadIgnoringCache();
      setNavigationError(undefined);
    } catch {
      // The WebView may detach between reading its state and reloading it.
    }
  }, [props.locale]);

  const navigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const webview = webviewRef.current;
    if (!webview || !webviewReadyRef.current) return;
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

  const runWhenWebviewReady = (
    action: (webview: Electron.WebviewTag) => void,
  ) => {
    const webview = webviewRef.current;
    if (!webview || !webviewReadyRef.current) return;
    try {
      action(webview);
    } catch {
      // Navigation controls are inert while the WebView is detaching.
    }
  };

  const reload = () => {
    refresh();
    runWhenWebviewReady((webview) => webview.reload());
  };

  return (
    <BrowserSurface
      busy={loading || pageLoading}
      className="browser-panel"
      label={props.title}
      state={
        error || navigationError
          ? "error"
          : loading || pageLoading
            ? "loading"
            : "ready"
      }
    >
      <BrowserToolbar
        className="browser-toolbar"
        label={`${props.title}: ${props.addressPlaceholder}`}
      >
        <BrowserNavigation
          className="browser-navigation-actions"
          label={props.title}
        >
          <BrowserNavigationButton
            className="browser-back-button"
            disabled={!webviewReady || !canGoBack}
            icon={
              rtl ? (
                <ArrowRightIcon weight="bold" />
              ) : (
                <ArrowLeftIcon weight="bold" />
              )
            }
            label={props.backLabel}
            onClick={() => runWhenWebviewReady((webview) => webview.goBack())}
          />
          <BrowserNavigationButton
            className="browser-forward-button"
            disabled={!webviewReady || !canGoForward}
            icon={
              rtl ? (
                <ArrowLeftIcon weight="bold" />
              ) : (
                <ArrowRightIcon weight="bold" />
              )
            }
            label={props.forwardLabel}
            onClick={() =>
              runWhenWebviewReady((webview) => webview.goForward())
            }
          />
          <BrowserNavigationButton
            className="browser-refresh-button"
            disabled={!webviewReady || (pageLoading && loading)}
            icon={<ArrowClockwiseIcon weight="bold" />}
            label={props.refreshLabel}
            onClick={reload}
          />
        </BrowserNavigation>
        <BrowserAddressForm
          className="browser-address-form"
          label={props.addressPlaceholder}
          onSubmit={navigate}
        >
          <BrowserAddressInput
            className="browser-address-input"
            label={props.addressPlaceholder}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={props.addressPlaceholder}
            spellCheck={false}
            value={address}
          />
          <BrowserGoButton
            className="browser-go-button"
            disabled={!webviewReady}
            label={props.goLabel}
          />
        </BrowserAddressForm>
      </BrowserToolbar>
      {(error || navigationError) && (
        <BrowserState className="browser-error" state="error">
          {error ?? navigationError}
        </BrowserState>
      )}
      <BrowserViewport
        className="browser-viewport"
        label={`${props.title}: ${file?.path ?? props.initialUrl ?? props.addressPlaceholder}`}
      >
        <webview
          className="browser-frame"
          partition={BROWSER_SESSION_PARTITION}
          ref={webviewRef}
          src={browserSource}
          title={`${props.title}: ${file?.path ?? props.initialUrl ?? ""}`}
        />
      </BrowserViewport>
    </BrowserSurface>
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

  const editorLabel = `${props.editLabel}: ${file?.path ?? props.path ?? props.title}`;

  return (
    <WorkspaceEditorToolbar
      dirty={dirty}
      modeToggle={{
        ariaLabel: props.title,
        onChange: setView,
        richLabel: props.richLabel,
        sourceLabel: props.sourceLabel,
        value: view,
      }}
      onKeyDown={(event) =>
        handleWorkspaceEditorSaveShortcut(
          event,
          dirty && saveState !== "saving",
          saveMarkdown,
        )
      }
      onSave={saveMarkdown}
      path={file?.path ?? props.path ?? props.title}
      readOnly={false}
      saveError={saveError}
      saveLabel={props.saveLabel}
      savedLabel={props.savedLabel}
      saveState={saveState}
      savingLabel={props.savingLabel}
      tools={
        <button
          className="text-button"
          disabled={!props.path || loading}
          onClick={refresh}
          type="button"
        >
          {props.refreshLabel}
        </button>
      }
      unsavedLabel={props.unsavedLabel}
    >
      {content === undefined ? (
        <WorkspaceContentState
          label={error ?? (loading ? props.refreshLabel : props.emptyMessage)}
          state={error ? "error" : loading ? "loading" : "empty"}
        >
          {error ?? (loading ? "…" : props.emptyMessage)}
        </WorkspaceContentState>
      ) : view === "rich" ? (
        <WorkspacePreview label={editorLabel}>
          <MarkdownContent
            imageFailureText={props.imageFailureMessage}
            resolveImage={resolveImage}
            text={draft}
          />
        </WorkspacePreview>
      ) : (
        <WorkspaceSourceEditor
          label={editorLabel}
          language="markdown"
          onChange={(event) => {
            setDraft(event.target.value);
            setSaveState("idle");
          }}
          spellCheck={false}
          value={draft}
          variant="markdown"
        />
      )}
    </WorkspaceEditorToolbar>
  );
}
