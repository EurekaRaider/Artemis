import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Dialog } from "@artemis/ui/feedback";
import { ArtemisIcon, ArtemisLogo } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";

export function UpdateAnnouncement({
  version,
  locale,
  onClose,
}: {
  version: string;
  locale: AppLocale;
  onClose(): void;
}) {
  return (
    <Dialog
      className="update-announcement"
      label={uiText(locale, "Update.completed", { version })}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <header>
        <ArtemisLogo size={44} />
        <h2>Artemis {version}</h2>
      </header>
      <footer>
        <a
          href={`https://github.com/EurekaRaider/Artemis/releases/tag/v${encodeURIComponent(version)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {uiText(locale, "Update.releaseNotes")}{" "}
          <ArtemisIcon name="external" />
        </a>
        <Button size="compact" onClick={onClose}>
          {uiText(locale, "Update.acknowledge")}
        </Button>
      </footer>
    </Dialog>
  );
}
