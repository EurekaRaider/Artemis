import { readOfficeAnnotations } from "../office/office-annotations.js";
import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";
import { AttachmentFileIcon } from "../components/AttachmentFileIcon.js";
import { FileAttachment } from "../components/FileAttachment.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { useEffect, useRef, useState } from "react";
import { AttachmentImagePreview } from "./AttachmentImagePreview.js";
import {
  attachmentIsImage,
  isAttachmentReference,
  type PromptAttachment,
  type PromptImage,
} from "@artemis/protocol";

function thumbnail(attachment: PromptAttachment) {
  return isAttachmentReference(attachment)
    ? attachment.thumbnail
    : !("type" in attachment)
      ? `data:${attachment.mimeType};base64,${attachment.data}`
      : undefined;
}

export function ComposerAttachments({
  attachments,
  locale,
  threadId,
  onRemove,
}: {
  attachments: PromptAttachment[];
  locale: AppLocale;
  threadId?: string | undefined;
  onRemove: (index: number) => void;
}) {
  const [page, setPage] = useState(0);
  const start = Math.min(
    page * 50,
    Math.max(0, Math.floor((attachments.length - 1) / 50) * 50),
  );
  const [preview, setPreview] = useState<PromptImage>();
  const [previewError, setPreviewError] = useState<string>();
  const previewRequest = useRef(0);
  useEffect(
    () => () => {
      previewRequest.current++;
    },
    [],
  );
  async function openPreview(attachment: PromptAttachment) {
    const request = ++previewRequest.current;
    setPreviewError(undefined);
    try {
      const image = isAttachmentReference(attachment)
        ? await window.artemis.previewPromptAttachment(attachment.id, threadId)
        : !("type" in attachment)
          ? attachment
          : undefined;
      if (request === previewRequest.current) setPreview(image);
    } catch {
      if (request === previewRequest.current)
        setPreviewError(uiText(locale, "ComposerAttachments.inline1"));
    }
  }

  return (
    <>
      {attachments.length > 50 && (
        <div>
          <button
            type="button"
            disabled={start === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
          >
            ←
          </button>
          <span>
            {start + 1}–{Math.min(start + 50, attachments.length)} /{" "}
            {attachments.length}
          </span>
          <button
            type="button"
            disabled={start + 50 >= attachments.length}
            onClick={() => setPage(page + 1)}
          >
            →
          </button>
        </div>
      )}
      <div className="attachment-image-strip composer-image-strip">
        {attachments.slice(start, start + 50).map((attachment, index) =>
          readOfficeAnnotations(attachment) ? null : (
            <div
              className="attachment-image-tile composer-resource-chip"
              key={isAttachmentReference(attachment) ? attachment.id : index}
            >
              {attachmentIsImage(attachment) ? (
                <button
                  type="button"
                  className="attachment-image-button"
                  aria-label={`${uiText(locale, "ComposerAttachments.inline2")}: ${attachment.name}`}
                  title={attachment.name}
                  onClick={() => void openPreview(attachment)}
                >
                  {thumbnail(attachment) ? (
                    <img src={thumbnail(attachment)} alt={attachment.name} />
                  ) : (
                    <AttachmentFileIcon name={attachment.name} />
                  )}
                  <span className="composer-resource-name">
                    {attachment.name}
                  </span>
                </button>
              ) : (
                <FileAttachment
                  name={attachment.name}
                  threadId={threadId}
                  locale={locale}
                  id={
                    isAttachmentReference(attachment)
                      ? attachment.id
                      : undefined
                  }
                  content={
                    "type" in attachment && attachment.type === "file"
                      ? attachment.content
                      : undefined
                  }
                />
              )}
              {isAttachmentReference(attachment) && (
                <span>
                  {attachment.status === "pending"
                    ? locale.startsWith("zh")
                      ? "已保存·按需读取"
                      : "Saved · read on demand"
                    : attachment.status === "error"
                      ? attachment.error
                      : locale.startsWith("zh")
                        ? "解析完成"
                        : "Parsed"}
                </span>
              )}
              <button
                type="button"
                className="composer-resource-remove"
                aria-label={`${attachmentIsImage(attachment) ? uiText(locale, "ComposerAttachments.inline4") : uiText(locale, "ComposerAttachments.inline3")}: ${attachment.name}`}
                onClick={() => onRemove(start + index)}
              >
                <ArtemisIcon name="close" width={14} height={14} />
              </button>
            </div>
          ),
        )}
      </div>
      {previewError && <p role="alert">{previewError}</p>}
      {preview && (
        <AttachmentImagePreview
          image={preview}
          locale={locale}
          onClose={() => {
            previewRequest.current++;
            setPreview(undefined);
          }}
        />
      )}
    </>
  );
}
