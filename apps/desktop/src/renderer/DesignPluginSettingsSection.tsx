// Settings → Capabilities → design plugin toggle (todo ⑤). The switch
// reflects the installed state: turning it on downloads the pack (or opens
// the manager for the offline path), turning it off removes it. Design files
// and version history on disk are never touched by either direction.
import { useEffect, useState } from "react";
import type { AppLocale, CapabilityPackStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { InlineNotice } from "@artemis/ui/feedback";
import { Switch } from "@artemis/ui/forms";
import { ManagementSection } from "@artemis/ui/management";
import { DesignCapabilityPanel } from "./DesignCapabilityPanel.js";
import { designPackCopy, designPackSettingsCopy } from "./design-pack-copy.js";

export function DesignPluginSettingsSection({ locale }: { locale: AppLocale }) {
  const t = designPackSettingsCopy(locale);
  const panelCopy = designPackCopy(locale);
  const [status, setStatus] = useState<CapabilityPackStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const activeVersion = status?.activeVersion;
  const installed = Boolean(activeVersion);
  const busyState = busy || Boolean(status && status.phase !== "idle");

  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .designCapabilityStatus()
        .then((value) => {
          if (active) setStatus(value);
        })
        .catch((reason: unknown) => {
          if (active) setError(String(reason));
        });
    refresh();
    const timer = setInterval(refresh, 750);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function run(operation: () => Promise<void>) {
    if (busyState) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      setStatus(await window.artemis.designCapabilityStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(next: boolean) {
    if (next) {
      // Online when the catalog offers a compatible release; otherwise the
      // manager dialog is the offline-import path.
      if (status?.availableVersion) await run(() => window.artemis.installDesignCapability());
      else setManageOpen(true);
      return;
    }
    if (activeVersion) await run(() => window.artemis.uninstallDesignCapability(activeVersion));
  }

  const statusLine = !installed
    ? t.statusNone
    : status?.updateVersion
      ? t.statusUpdate.replace("{version}", status.updateVersion)
      : t.statusInstalled;

  return (
    <ManagementSection
      className="settings-section"
      title={t.title}
      description={t.hint}
      actions={
        <Button variant="quiet" onClick={() => setManageOpen(true)}>
          {t.manage}
        </Button>
      }
    >
      {error || status?.error ? (
        <InlineNotice tone="danger">{error ?? status?.error}</InlineNotice>
      ) : null}
      {manageOpen ? (
        <DesignCapabilityPanel locale={locale} onClose={() => setManageOpen(false)} />
      ) : null}
      <div className="settings-form-row">
        <div className="settings-row-copy">
          <div className="settings-row-label">
            {busyState ? panelCopy.working : statusLine}
          </div>
        </div>
        <div className="settings-row-control">
          <Switch
            checked={installed}
            disabled={busyState || !status}
            label={t.title}
            labelVisibility="hidden"
            onCheckedChange={(checked) => void toggle(checked)}
          />
        </div>
      </div>
    </ManagementSection>
  );
}
