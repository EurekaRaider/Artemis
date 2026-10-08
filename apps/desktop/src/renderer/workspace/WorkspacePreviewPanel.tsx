import { PreviewCanvas } from "../computer-use/PreviewCanvas.js";
import { BrowserPreviewTools } from "./BrowserPreviewTools.js";
import { IconButton } from "@artemis/ui/actions";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArtemisIcon } from "@artemis/ui/icons";
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

import type { WorkspaceTextFile } from "../../shared/api.js";
import {
  shouldReloadBrowserForLocaleChange,
  type BrowserLocale,
} from "../../shared/i18n/browser-locale.js";
import { localeDirection } from "../../shared/i18n/locales.js";
import { normalizeBrowserAddress } from "../app/browser-navigation.js";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { handleWorkspaceEditorSaveShortcut } from "./workspace-editor-shortcut.js";
import { markdownViewState, usePersistentUiState } from "../app/ui-state.js";

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
  tabId: string;
  onEvidence(
    text: string,
    image?: { data: string; mimeType: "image/jpeg" },
  ): void;
  addressPlaceholder: string;
  backLabel: string;
  forwardLabel: string;
  goLabel: string;
  initialUrl?: string | undefined;
  locale: BrowserLocale;
}

function useWorkspacePreviewFile({
  threadId,
  path,
  revision,
}: Pick<WorkspacePreviewProps, "threadId" | "path" | "revision">) {
  const [reload, setReload] = useState(0);
  const [file, setFile] = useState<
    WorkspaceTextFile | { path: string; kind: "pdf"; url: string }
  >();
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
    setFile(undefined);
    const request = /\.pdf$/iu.test(path)
      ? window.artemis.openWorkspacePdf(threadId, path).then((url) => ({
          path,
          kind: "pdf" as const,
          url,
        }))
      : window.artemis.readWorkspaceTextFile(threadId, path);
    void request
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
  const [session, setSession] =
    useState<import("@artemis/protocol").BrowserSessionSnapshot>();
  const [address, setAddress] = useState(props.initialUrl ?? "");
  const [error, setError] = useState<string>();
  const rtl = localeDirection(props.locale) === "rtl";
  const previousLocale = useRef(props.locale);
  const initialUrl = useRef(props.initialUrl);
  const command = useCallback(
    async (
      action: "back" | "forward" | "reload" | "navigate",
      url?: string,
    ) => {
      if (!props.threadId) return;
      const result = await window.artemis.browserSession(
        action === "navigate"
          ? { action, threadId: props.threadId, tabId: props.tabId, url: url! }
          : { action, threadId: props.threadId, tabId: props.tabId },
      );
      if (result) setSession(result);
    },
    [props.threadId, props.tabId],
  );
  const run = (operation: Promise<unknown>) => {
    setError(undefined);
    void operation.catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  useEffect(() => {
    if (!props.threadId) return;
    let active = true;
    let latestEvent: typeof session;
    const unsubscribe = window.artemis.onBrowserSession((value) => {
      if (value.threadId !== props.threadId || value.tabId !== props.tabId)
        return;
      latestEvent = value;
      setSession(value);
      setError(value.error);
      setAddress(value.url === "about:blank" ? "" : value.url);
    });
    void window.artemis
      .browserSession({
        action: "open",
        threadId: props.threadId,
        tabId: props.tabId,
        ...(props.initialUrl ? { url: props.initialUrl } : {}),
        ...(props.path ? { path: props.path } : {}),
        ...(props.revision ? { revision: props.revision } : {}),
      })
      .then((value) => {
        if (active && value) {
          // A live event can arrive before the older IPC response.
          const latest = latestEvent ?? value;
          setSession(latest);
          setAddress(
            props.path ?? (latest.url === "about:blank" ? "" : latest.url),
          );
        }
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [props.threadId, props.tabId, props.path, props.revision]);
  useEffect(() => {
    if (initialUrl.current !== props.initialUrl && props.initialUrl)
      run(command("navigate", props.initialUrl));
    initialUrl.current = props.initialUrl;
  }, [props.initialUrl, command]);
  useEffect(() => {
    const old = previousLocale.current;
    previousLocale.current = props.locale;
    if (
      session &&
      shouldReloadBrowserForLocaleChange(old, props.locale, session.url)
    )
      run(command("reload"));
  }, [props.locale, session?.url, command]);
  const navigate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      run(
        command(
          "navigate",
          props.path && address.trim() === props.path && session
            ? session.url
            : normalizeBrowserAddress(address, props.locale),
        ),
      );
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <BrowserSurface
      busy={!session || session.loading}
      className="browser-panel"
      label={props.title}
      state={
        error ? "error" : !session || session.loading ? "loading" : "ready"
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
            disabled={!session?.canGoBack}
            icon={<ArtemisIcon name={rtl ? "chev-right" : "chev-left"} />}
            label={props.backLabel}
            onClick={() => run(command("back"))}
          />
          <BrowserNavigationButton
            className="browser-forward-button"
            disabled={!session?.canGoForward}
            icon={<ArtemisIcon name={rtl ? "chev-left" : "chev-right"} />}
            label={props.forwardLabel}
            onClick={() => run(command("forward"))}
          />
          <BrowserNavigationButton
            className="browser-refresh-button"
            disabled={!session}
            icon={<ArtemisIcon name="refresh" />}
            label={props.refreshLabel}
            onClick={() => run(command("reload"))}
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
            disabled={!session}
            label={props.goLabel}
          />
        </BrowserAddressForm>
      </BrowserToolbar>
      {error && (
        <BrowserState className="browser-error" state="error">
          {error}
        </BrowserState>
      )}
      <BrowserPreviewTools
        enabled={!/\.pdf$/iu.test(props.path ?? "")}
        threadId={props.threadId}
        tabId={props.tabId}
        contentsId={session?.contentsId}
        locale={props.locale}
        onEvidence={props.onEvidence}
      >
        <BrowserViewport className="browser-viewport" label={props.title}>
          {session && (
            <PreviewCanvas
              key={session.sessionId}
              sessionId={session.sessionId}
              browser={session}
              label={props.title}
            />
          )}
        </BrowserViewport>
      </BrowserPreviewTools>
    </BrowserSurface>
  );
}

export function MarkdownReaderPanel(props: MarkdownReaderProps) {
  const [view, setView] = usePersistentUiState(
    "artemis-markdown-view",
    markdownViewState,
    "rich",
  );
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [saveError, setSaveError] = useState<string>();
  const { error, file, loading, refresh, replaceFile } =
    useWorkspacePreviewFile(props);
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
        <IconButton
          icon={<ArtemisIcon name="refresh" />}
          label={props.refreshLabel}
          title={props.refreshLabel}
          disabled={!props.path || loading}
          onClick={refresh}
        />
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
        <WorkspacePreview className="document-reader" label={editorLabel}>
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
