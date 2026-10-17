import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import { Dialog } from "@artemis/ui/feedback";
import type {
  ConversationShare,
  ShareDestination,
  ShareOptions,
  SharePreview,
} from "../../shared/conversation-share.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import "./conversation-share.css";

const defaultOptions: ShareOptions = {
  tools: false,
  thinking: false,
  attachments: false,
};
export function ConversationShareDialog({
  threadId,
  locale,
  onClose,
}: {
  threadId: string;
  locale: AppLocale;
  onClose(): void;
}) {
  const [preview, setPreview] = useState<SharePreview>();
  const [history, setHistory] = useState<ConversationShare[]>([]);
  const [destination, setDestination] = useState<ShareDestination>("auto");
  const [busy, setBusy] = useState<
    "prepare" | "update" | "upload" | "export" | "delete"
  >("prepare");
  const [idle, setIdle] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [deleting, setDeleting] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const currentId = useRef<string | undefined>(undefined);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  function syncPreviewTheme() {
    previewFrame.current?.contentWindow?.postMessage(
      {
        type: "artemis-share-theme",
        theme:
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
      },
      "*",
    );
  }
  useEffect(() => {
    const observer = new MutationObserver(syncPreviewTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const text = (key: Parameters<typeof uiText>[1]) => uiText(locale, key);
  const working = !idle;
  const resolved =
    destination === "auto"
      ? preview?.destinations.radius
        ? "radius"
        : "gist"
      : destination;
  const available = Boolean(preview?.destinations[resolved]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      window.artemis.prepareConversationShare(threadId, defaultOptions),
      window.artemis.listConversationShares(threadId),
    ]).then(([prepared, records]) => {
      if (!active) {
        if (prepared.status === "fulfilled")
          void window.artemis.cancelConversationShare(prepared.value.id);
        return;
      }
      if (prepared.status === "fulfilled") {
        currentId.current = prepared.value.id;
        setPreview(prepared.value);
      } else setError(String(prepared.reason));
      if (records.status === "fulfilled") setHistory(records.value);
      setIdle(true);
    });
    return () => {
      active = false;
      if (currentId.current)
        void window.artemis.cancelConversationShare(currentId.current);
    };
  }, [threadId]);

  async function action(kind: typeof busy, run: () => Promise<void>) {
    setBusy(kind);
    setIdle(false);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIdle(true);
    }
  }
  function update(
    options: ShareOptions,
    excludedIds = preview?.messages
      .filter((message) => !message.included)
      .map((message) => message.id) ?? [],
  ) {
    if (!preview) return;
    void action("update", async () =>
      setPreview(
        await window.artemis.updateConversationShare(
          preview.id,
          options,
          excludedIds,
        ),
      ),
    );
  }
  const close = () => {
    if (working && busy === "upload" && preview)
      void window.artemis.cancelConversationShare(preview.id);
    else onClose();
  };
  return (
    <Dialog
      open
      className="conversation-share-dialog"
      label={text("Share.title")}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <header className="share-header">
        <span className="share-header-icon">
          <ArtemisIcon name="external" />
        </span>
        <div>
          <h2>{text("Share.title")}</h2>
          <p className="share-hint">{text("Share.hint")}</p>
        </div>
        <IconButton
          icon={<ArtemisIcon name="close" />}
          label={text("Share.close")}
          onClick={close}
        />
      </header>
      <div className="share-body">
        {error && (
          <p role="alert" className="share-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {!preview && working && <p role="status">{text("Share.preparing")}</p>}
        {preview && (
          <>
            <div className="share-snapshot-heading">
              <h3>{preview.title}</h3>
              <span>{text("Share.snapshot")}</span>
            </div>
            <div className="share-content">
              <aside className="share-selection">
                <div className="share-section-heading">
                  <h4>{text("Share.content")}</h4>
                  <span>
                    {preview.messages.filter((m) => m.included).length} /{" "}
                    {preview.messages.length}
                  </span>
                </div>
                <fieldset
                  className="share-options"
                  disabled={working || attempted}
                >
                  {(["tools", "thinking", "attachments"] as const).map(
                    (key) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={preview.options[key]}
                          onChange={(event) =>
                            update({
                              ...preview.options,
                              [key]: event.target.checked,
                            })
                          }
                        />
                        {text(
                          key === "tools"
                            ? "Share.tools"
                            : key === "thinking"
                              ? "Share.thinking"
                              : "Share.attachments",
                        )}
                      </label>
                    ),
                  )}
                </fieldset>
                <section
                  className="share-message-list"
                  aria-label={text("Share.messages")}
                >
                  <h4>{text("Share.messages")}</h4>
                  {preview.messages.map((message) => (
                    <label key={message.id} data-included={message.included}>
                      <input
                        type="checkbox"
                        aria-label={`${text("Share.include")} ${message.role}: ${message.text.slice(0, 60)}`}
                        checked={message.included}
                        disabled={working || attempted}
                        onChange={(event) => {
                          const excluded = new Set(
                            preview.messages
                              .filter((m) => !m.included)
                              .map((m) => m.id),
                          );
                          if (event.target.checked) excluded.delete(message.id);
                          else excluded.add(message.id);
                          update(preview.options, [...excluded]);
                        }}
                      />
                      <span>
                        <strong>
                          {text(
                            message.role === "user"
                              ? "Share.user"
                              : message.role === "assistant"
                                ? "Share.assistant"
                                : "Share.tool",
                          )}
                        </strong>
                        <span>{message.text.slice(0, 240)}</span>
                      </span>
                    </label>
                  ))}
                </section>
              </aside>
              <section
                className="share-preview-panel"
                aria-label={text("Share.preview")}
              >
                <div className="share-section-heading">
                  <h4>{text("Share.preview")}</h4>
                  <span>
                    <ArtemisIcon name="lock" />
                    {text("Share.offline")}
                  </span>
                </div>
                <iframe
                  ref={previewFrame}
                  onLoad={syncPreviewTheme}
                  title={text("Share.preview")}
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  src={preview.previewUrl}
                />
              </section>
            </div>
            <div className="share-publish">
              <div className="share-publish-settings">
                <label className="share-destination">
                  {text("Share.destination")}
                  <select
                    value={destination}
                    disabled={working || attempted}
                    onChange={(event) =>
                      setDestination(event.target.value as ShareDestination)
                    }
                  >
                    <option value="auto">{text("Share.auto")}</option>
                    <option value="gist">GitHub Gist</option>
                    <option value="radius">Radius</option>
                  </select>
                </label>
                <p className="share-hint share-visibility">
                  <ArtemisIcon
                    name={resolved === "radius" ? "agents" : "lock"}
                  />
                  {resolved === "radius"
                    ? text("Share.radiusNotice")
                    : text("Share.gistNotice")}
                </p>
                {!available && <p>{text("Share.unavailable")}</p>}
              </div>
              <footer>
                <Button
                  icon={<ArtemisIcon name="download" />}
                  disabled={working}
                  onClick={() =>
                    void action("export", async () => {
                      if (
                        await window.artemis.exportConversationShare(preview.id)
                      )
                        setNotice(text("Share.exported"));
                    })
                  }
                >
                  {text("Share.export")}
                </Button>
                {working && busy === "upload" ? (
                  <Button
                    onClick={() =>
                      void window.artemis.cancelConversationShare(preview.id)
                    }
                  >
                    {text("Share.cancel")}
                  </Button>
                ) : attempted ? (
                  <Button
                    disabled={working}
                    onClick={() =>
                      void action("prepare", async () => {
                        const next =
                          await window.artemis.prepareConversationShare(
                            threadId,
                            preview.options,
                          );
                        currentId.current = next.id;
                        setPreview(next);
                        setAttempted(false);
                      })
                    }
                  >
                    {text("Share.newSnapshot")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    icon={<ArtemisIcon name="external" />}
                    disabled={
                      working ||
                      !available ||
                      !preview.messages.some((message) => message.included)
                    }
                    onClick={() =>
                      void action("upload", async () => {
                        setAttempted(true);
                        const record =
                          await window.artemis.uploadConversationShare(
                            preview.id,
                            destination,
                          );
                        setHistory((records) => [
                          record,
                          ...records.filter((item) => item.id !== record.id),
                        ]);
                      })
                    }
                  >
                    {text("Share.upload")}
                  </Button>
                )}
                {working && (
                  <span role="status">
                    {text(
                      busy === "upload" ? "Share.uploading" : "Share.preparing",
                    )}
                  </span>
                )}
              </footer>
            </div>
          </>
        )}
        <section className="share-history" aria-label={text("Share.history")}>
          <div className="share-section-heading">
            <h3>{text("Share.history")}</h3>
            <span>{history.length}</span>
          </div>
          {!history.length && (
            <p className="share-hint">{text("Share.empty")}</p>
          )}
          {history.map((record) => (
            <div key={record.id} className="share-record">
              <span className="share-record-icon">
                <ArtemisIcon
                  name={record.destination === "gist" ? "github" : "cloud"}
                />
              </span>
              <div className="share-record-info">
                <strong>
                  {record.destination === "gist" ? "GitHub Gist" : "Radius"}
                </strong>
                <time dateTime={record.createdAt}>
                  {new Date(record.createdAt).toLocaleString(locale)}
                </time>
              </div>
              <div className="share-record-actions">
                <a href={record.url} target="_blank" rel="noreferrer">
                  {text(
                    record.destination === "radius"
                      ? "Share.manage"
                      : "Share.open",
                  )}
                  <ArtemisIcon name="external" />
                </a>
                <Button
                  variant="secondary"
                  icon={<ArtemisIcon name="copy" />}
                  onClick={() =>
                    void navigator.clipboard.writeText(record.url).then(
                      () => setNotice(text("Share.copied")),
                      (error) => setError(String(error)),
                    )
                  }
                >
                  {text("Share.copy")}
                </Button>
                {record.destination === "gist" &&
                  (deleting === record.id ? (
                    <>
                      <span>{text("Share.deleteConfirm")}</span>
                      <Button
                        disabled={working}
                        onClick={() =>
                          void action("delete", async () => {
                            await window.artemis.deleteConversationShare(
                              record.id,
                            );
                            setHistory((records) =>
                              records.filter((item) => item.id !== record.id),
                            );
                            setDeleting(undefined);
                          })
                        }
                      >
                        {text("Share.confirmDelete")}
                      </Button>
                      <Button
                        disabled={working}
                        onClick={() => setDeleting(undefined)}
                      >
                        {text("Share.cancel")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      disabled={working}
                      onClick={() => setDeleting(record.id)}
                    >
                      {text("Share.delete")}
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </Dialog>
  );
}
