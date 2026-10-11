import { useEffect, useState } from "react";
import type { AttachmentImportProgress as Progress } from "../../shared/api.js";
import type { PromptAttachment, AppLocale } from "@artemis/protocol";
export function AttachmentImportProgress({
  locale,
  onImported,
}: {
  locale: AppLocale;
  onImported: (items: PromptAttachment[]) => void;
}) {
  const [items, setItems] = useState<Map<string, Progress>>(() => new Map());
  const [error, setError] = useState("");
  const zh = locale.startsWith("zh");
  useEffect(
    () =>
      window.artemis.onAttachmentImportProgress?.((item) =>
        setItems((current) => {
          const next = new Map(current);
          if (item.status === "saved") next.delete(item.id);
          else next.set(item.id, item);
          return next;
        }),
      ),
    [],
  );
  const values = [...items.values()];
  if (!values.length && !error) return null;
  return (
    <div aria-live="polite">
      <p>
        {zh ? "附件保存" : "Saving attachments"}: {values.length}
      </p>
      {values.slice(0, 20).map((item) => (
        <div key={item.id}>
          <span>
            {item.name} ·{" "}
            {item.status === "error"
              ? item.error
              : item.status === "queued"
                ? zh
                  ? "等待保存"
                  : "Queued"
                : `${Math.floor((item.copied / Math.max(1, item.total)) * 100)}%`}
          </span>
          {item.status === "error" ? (
            <button
              type="button"
              onClick={() => {
                setItems((current) => {
                  const next = new Map(current);
                  next.delete(item.id);
                  return next;
                });
                void window.artemis
                  .retryPromptAttachment(item.id)
                  .then((ref) => onImported([ref]))
                  .catch((reason) => setError(String(reason)));
              }}
            >
              {zh ? "重试" : "Retry"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                void window.artemis.cancelPromptAttachment(item.id)
              }
            >
              {zh ? "取消" : "Cancel"}
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
