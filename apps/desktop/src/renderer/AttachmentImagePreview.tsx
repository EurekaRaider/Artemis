import type { AppLocale } from "@artemis/protocol";
import { uiText } from "../shared/ui-text.js";
import { createPortal } from "react-dom";
import type { PromptImage } from "@artemis/protocol";

export function AttachmentImagePreview({
  image,
  locale,
  onClose,
}: {
  image: PromptImage;
  locale: AppLocale;
  onClose: () => void;
}) {
  return createPortal(
    <dialog
      className="composer-attachment-dialog"
      aria-label={image.name}
      ref={(element) => {
        if (element && !element.open) element.showModal();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <header>
        <strong>{image.name}</strong>
        <button
          type="button"
          aria-label={uiText(locale, "AttachmentImagePreview.inline1")}
          onClick={(event) => event.currentTarget.closest("dialog")?.close()}
        >
          ×
        </button>
      </header>
      <img
        alt={image.name}
        src={`data:${image.mimeType};base64,${image.data}`}
      />
    </dialog>,
    document.body,
  );
}
