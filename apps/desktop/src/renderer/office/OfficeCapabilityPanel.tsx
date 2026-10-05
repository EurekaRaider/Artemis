import type { AppLocale } from "@artemis/protocol";
import {
  CapabilityPackPanel,
  type CapabilityPackCopy,
} from "../capabilities/CapabilityPackPanel.js";
import { officeCopy } from "./office-copy.js";

export function OfficeCapabilityPanel({
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
  const t = officeCopy(locale);
  const copy: CapabilityPackCopy = {
    runtime: t.runtime,
    manage: t.manage,
    manageDescription: t.manageDescription,
    shared: t.shared,
    lite: t.lite,
    working: t.working,
    cancel: t.cancel,
    installed: t.installed,
    inactive: t.inactive,
    rollback: t.rollback,
    remove: t.remove,
    inUse: t.inUse,
    removeHint: t.removeHint,
    checkFailed: t.checkFailed,
    updateAvailable: t.updateAvailable,
    updateNow: t.updateNow,
    upToDate: t.upToDate,
    noUpdates: t.noUpdates,
    updatesUnavailable: t.updatesUnavailable,
    checkUpdates: t.checkUpdates,
    checkingUpdates: t.checkingUpdates,
    offlineMaintenance: t.offlineMaintenance,
    selectOfflinePack: t.selectOfflinePack,
    offlineMaintenanceHint: t.offlineMaintenanceHint,
    offlineHint: t.offlineHint,
    unavailable: t.unavailable,
    install: t.install,
    offline: t.offline,
    close: t.close,
  };
  return (
    <CapabilityPackPanel
      installed={installed}
      copy={copy}
      api={{
        status: () => window.artemis.officeCapabilityStatus(),
        checkUpdates: () => window.artemis.checkOfficeCapabilityUpdates(),
        install: () => window.artemis.installOfficeCapability(),
        importOffline: () => window.artemis.importOfficeCapability(),
        cancel: () => window.artemis.cancelOfficeCapability(),
        activate: (version) => window.artemis.activateOfficeCapability(version),
        uninstall: (version) =>
          window.artemis.uninstallOfficeCapability(version),
      }}
      onClose={onClose}
      {...(onInstalledChange ? { onInstalledChange } : {})}
    />
  );
}
