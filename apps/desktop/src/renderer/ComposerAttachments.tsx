import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  zh,
  onRemove,
  onClear,
}: {
  attachments: PromptAttachment[];
  zh: boolean;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const [preview, setPreview] = useState<PromptImage>();
  const [previewError, setPreviewError] = useState<string>();
  const previewRequest = useRef(0);
  useEffect(
    () => () => {
      previewRequest.current++;
    },
    [],
  );
  const dialog = useRef<HTMLDialogElement | null>(null);
  const pending = attachments.filter(
    (a) => isAttachmentReference(a) && a.status === "pending",
  ).length;
  const failed = attachments.filter(
    (a) => isAttachmentReference(a) && a.status === "error",
  ).length;
  const images = attachments.filter(attachmentIsImage).length;
  const count = zh
    ? `${attachments.length} 个附件`
    : `${attachments.length} attachments`;
  const status = pending
    ? zh
      ? `${pending} 个处理中`
      : `${pending} processing`
    : failed
      ? zh
        ? `${failed} 个处理失败`
        : `${failed} failed`
      : zh
        ? `${images} 张图片 · ${attachments.length - images} 个文件`
        : `${images} images · ${attachments.length - images} files`;

  async function openPreview(attachment: PromptAttachment) {
    const request = ++previewRequest.current;
    setPreviewError(undefined);
    try {
      const image = isAttachmentReference(attachment)
        ? await window.artemis.previewPromptAttachment(attachment.id)
        : !("type" in attachment)
          ? attachment
          : undefined;
      if (request === previewRequest.current) setPreview(image);
    } catch {
      if (request === previewRequest.current)
        setPreviewError(zh ? "无法预览图片" : "Image preview unavailable");
    }
  }

  return (
    <>
      <details
        className="composer-attachments"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary className="composer-attachments-summary">
          <span className="composer-attachments-thumbnails" aria-hidden="true">
            {attachments
              .slice(0, 3)
              .map((attachment, index) =>
                thumbnail(attachment) ? (
                  <img key={index} src={thumbnail(attachment)} alt="" />
                ) : (
                  <span key={index}>▤</span>
                ),
              )}
          </span>
          <strong>{count}</strong>
          <span className="composer-attachments-status" role="status">
            {status}
          </span>
          <span className="composer-attachments-chevron" aria-hidden="true">
            ⌄
          </span>
        </summary>
        <div className="composer-attachments-actions">
          <span>
            {zh
              ? "图片按预算发送，文件按需读取"
              : "Images fit the budget; files are read on demand"}
          </span>
          <button type="button" onClick={onClear}>
            {zh ? "全部清空" : "Clear all"}
          </button>
        </div>
        <div className="composer-attachments-list">
          {attachments.map((attachment, index) => {
            const reference = isAttachmentReference(attachment)
              ? attachment
              : undefined;
            const state =
              reference?.status === "pending"
                ? zh
                  ? "处理中"
                  : "Processing"
                : reference?.status === "error"
                  ? zh
                    ? "处理失败"
                    : "Failed"
                  : reference?.kind === "image" &&
                      (reference.width !== reference.displayWidth ||
                        reference.height !== reference.displayHeight)
                    ? zh
                      ? "已缩放"
                      : "Resized"
                    : attachmentIsImage(attachment)
                      ? zh
                        ? "已就绪"
                        : "Ready"
                      : zh
                        ? "按需读取"
                        : "On demand";
            const description = [
              attachment.name,
              state,
              reference?.error,
              reference?.width
                ? `${reference.width} × ${reference.height} → ${reference.displayWidth} × ${reference.displayHeight}`
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                className="composer-attachment-row"
                key={reference?.id ?? `${attachment.name}-${index}`}
                title={description}
              >
                <button
                  className="composer-attachment-preview"
                  type="button"
                  disabled={!attachmentIsImage(attachment)}
                  onClick={() => void openPreview(attachment)}
                  aria-label={`${zh ? "预览" : "Preview"}: ${attachment.name}`}
                >
                  {thumbnail(attachment) ? (
                    <img alt="" src={thumbnail(attachment)} />
                  ) : (
                    <span aria-hidden="true">▤</span>
                  )}
                  <span>
                    {index + 1}. {attachment.name}
                  </span>
                </button>
                <span className="composer-attachment-state">{state}</span>
                <button
                  className="composer-attachment-remove"
                  type="button"
                  aria-label={`${zh ? "移除附件" : "Remove attachment"}: ${attachment.name}`}
                  onClick={() => onRemove(index)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        {previewError && <p role="alert">{previewError}</p>}
      </details>
      {preview &&
        createPortal(
          <dialog
            className="composer-attachment-dialog"
            ref={(element) => {
              dialog.current = element;
              if (element && !element.open) element.showModal();
            }}
            onClose={() => {
              previewRequest.current++;
              setPreview(undefined);
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) dialog.current?.close();
            }}
          >
            <header>
              <strong>{preview.name}</strong>
              <button
                type="button"
                aria-label={zh ? "关闭预览" : "Close preview"}
                onClick={() => dialog.current?.close()}
              >
                ×
              </button>
            </header>
            <img
              alt={preview.name}
              src={`data:${preview.mimeType};base64,${preview.data}`}
            />
          </dialog>,
          document.body,
        )}
    </>
  );
}
