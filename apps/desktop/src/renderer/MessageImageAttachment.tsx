import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../shared/ui-text.js";
import { useEffect, useRef, useState } from "react";
import type { PromptImage } from "@artemis/protocol";
import { AttachmentImagePreview } from "./AttachmentImagePreview.js";

export function MessageImageAttachment({
  threadId,
  sourceId,
  name,
  thumbnail,
  locale,
}: {
  threadId: string;
  sourceId: string;
  name: string;
  thumbnail?: string | undefined;
  locale: AppLocale;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [image, setImage] = useState<PromptImage>();
  const [preview, setPreview] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const request = useRef<Promise<PromptImage> | undefined>(undefined);
  const mounted = useRef(true);
  const load = () =>
    (request.current ??= window.artemis.readTaskSourceImage(
      threadId,
      sourceId,
    ));
  useEffect(() => {
    mounted.current = true;
    if (thumbnail)
      return () => {
        mounted.current = false;
      };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void load()
        .then((result) => {
          if (mounted.current) setImage(result);
        })
        .catch(() => {
          if (mounted.current) setUnavailable(true);
        });
    });
    if (button.current) observer.observe(button.current);
    return () => {
      mounted.current = false;
      observer.disconnect();
    };
  }, [thumbnail]);
  const src = image ? `data:${image.mimeType};base64,${image.data}` : thumbnail;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="attachment-image-button"
        title={name}
        aria-label={`${uiText(locale, "ComposerAttachments.inline2")}: ${name}`}
        onClick={() => {
          if (unavailable) request.current = undefined;
          setUnavailable(false);
          void (image ? Promise.resolve(image) : load())
            .then((result) => {
              if (mounted.current) {
                setImage(result);
                setPreview(true);
              }
            })
            .catch(() => {
              if (mounted.current) setUnavailable(true);
            });
        }}
      >
        {src && !unavailable ? (
          <img
            alt={name}
            src={src}
            loading="lazy"
            onError={() => setUnavailable(true)}
          />
        ) : (
          <span>
            {name}
            {unavailable && (
              <small>{uiText(locale, "MessageImageAttachment.inline1")}</small>
            )}
          </span>
        )}
      </button>
      {preview && image && (
        <AttachmentImagePreview
          image={image}
          locale={locale}
          onClose={() => setPreview(false)}
        />
      )}
    </>
  );
}
