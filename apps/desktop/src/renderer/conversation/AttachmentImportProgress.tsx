import { useEffect, useState } from "react";
import type { AttachmentImportProgress as Progress } from "../../shared/api.js";
import type { PromptAttachment, AppLocale } from "@artemis/protocol";
import { Button, IconButton } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
export function AttachmentImportProgress({
  locale,
  onImported,
}: {
  locale: AppLocale;
  onImported: (items: PromptAttachment[]) => void;
}) {
  const [items, setItems] = useState<Map<string, Progress>>(() => new Map());
  const [error, setError] = useState("");
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
    <div className="attachment-import-progress" aria-live="polite" aria-label={values.length ? uiText(locale, "Review06.savingAttachments", { count: values.length }) : undefined}>
      {values.slice(0, 20).map((item) => {
        const percent = Math.floor((item.copied / Math.max(1, item.total)) * 100);
        const extension = item.name.split(".").pop()?.slice(0, 5).toUpperCase();
        return (
          <div className="attachment-import-item" key={item.id}>
            <span className="attachment-import-file" aria-hidden="true" data-extension={extension}><span>{extension}</span></span>
            <span className="attachment-import-copy">
              <span title={item.name}>{item.name}</span>
              {item.status === "error" ? (
                <span className="attachment-import-error" role="alert">{item.error}</span>
              ) : (
                <span className="attachment-import-bar" role="progressbar" aria-label={item.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <i style={{ width: `${percent}%` }} />
                </span>
              )}
            </span>
            {item.status === "error" ? (
              <Button onClick={() => {
                setItems((current) => {
                  const next = new Map(current);
                  next.delete(item.id);
                  return next;
                });
                void window.artemis.retryPromptAttachment(item.id)
                  .then((ref) => onImported([ref]))
                  .catch((reason) => setError(String(reason)));
              }}>{uiText(locale, "App_copy.queueRetry")}</Button>
            ) : (
              <IconButton size="compact" iconSize="sm" variant="quiet" label={uiText(locale, "App_copy.renameCancel")} icon={<ArtemisIcon name="close" width={14} height={14} />} onClick={() => void window.artemis.cancelPromptAttachment(item.id)} />
            )}
          </div>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
