import { createPortal } from "react-dom";
import type { PromptImage } from "@artemis/protocol";

export function AttachmentImagePreview({
  image,
  zh,
  onClose,
}: {
  image: PromptImage;
  zh: boolean;
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
          aria-label={zh ? "关闭预览" : "Close preview"}
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
