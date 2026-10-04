import type { AppLocale } from "@artemis/protocol";
import { CapabilityPackPanel } from "../capabilities/CapabilityPackPanel.js";
import { designPackCopy } from "./design-pack-copy.js";

export function DesignCapabilityPanel({
  locale,
  onClose,
  installed = false,
  onInstalledChange,
}: {
  locale: AppLocale;
  onClose(): void;
  installed?: boolean;
  onInstalledChange?(installed: boolean): void;
}) {
  return (
    <CapabilityPackPanel
      copy={designPackCopy(locale)}
      api={{
        status: () => window.artemis.designCapabilityStatus(),
        checkUpdates: () => window.artemis.checkDesignCapabilityUpdates(),
        install: () => window.artemis.installDesignCapability(),
        importOffline: () => window.artemis.importDesignCapability(),
        cancel: () => window.artemis.cancelDesignCapability(),
        activate: (version) => window.artemis.activateDesignCapability(version),
        uninstall: (version) =>
          window.artemis.uninstallDesignCapability(version),
      }}
      onClose={onClose}
      {...(onInstalledChange ? { onInstalledChange } : {})}
    />
  );
}
