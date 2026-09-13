import { FileAttachment } from "./FileAttachment.js";
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
  zh,
  onRemove,
}: {
  attachments: PromptAttachment[];
  zh: boolean;
  onRemove: (index: number) => void;
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
      <div className="attachment-image-strip composer-image-strip">
        {attachments.map((attachment, index) => (
          <div
            className="attachment-image-tile"
            key={isAttachmentReference(attachment) ? attachment.id : index}
          >
            {attachmentIsImage(attachment) ? (
              <button
                type="button"
                className="attachment-image-button"
                aria-label={`${zh ? "查看图片" : "View image"}: ${attachment.name}`}
                title={attachment.name}
                onClick={() => void openPreview(attachment)}
              >
                {thumbnail(attachment) ? (
                  <img src={thumbnail(attachment)} alt={attachment.name} />
                ) : (
                  <span>{attachment.name}</span>
                )}
              </button>
            ) : (
              <FileAttachment
                name={attachment.name}
                zh={zh}
                id={
                  isAttachmentReference(attachment) ? attachment.id : undefined
                }
                content={
                  "type" in attachment && attachment.type === "file"
                    ? attachment.content
                    : undefined
                }
              />
            )}
            <button
              type="button"
              className="attachment-image-remove"
              aria-label={`${attachmentIsImage(attachment) ? (zh ? "移除图片" : "Remove image") : zh ? "移除文件" : "Remove file"}: ${attachment.name}`}
              onClick={() => onRemove(index)}
            >
              <ArtemisIcon name="close" width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
      {previewError && <p role="alert">{previewError}</p>}
      {preview && (
        <AttachmentImagePreview
          image={preview}
          zh={zh}
          onClose={() => {
            previewRequest.current++;
            setPreview(undefined);
          }}
        />
      )}
    </>
  );
}
