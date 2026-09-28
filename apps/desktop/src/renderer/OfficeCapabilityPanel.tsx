import { useEffect, useState } from "react";
import type { AppLocale, CapabilityPackStatus } from "@artemis/protocol";
import { Button, Icon } from "@artemis/ui/actions";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import { officeCopy } from "./office-copy.js";
import "./office-workbench.css";

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
  const [status, setStatus] = useState<CapabilityPackStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const hasInstallation = status ? status.versions.length > 0 : installed;
  const title = hasInstallation ? t.manage : t.runtime;
  const checking = status?.updateCheck === "checking";
  const operationBusy =
    busy || checking || Boolean(status && status.phase !== "idle");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .officeCapabilityStatus()
        .then((value) => {
          if (active) {
            setStatus(value);
            onInstalledChange?.(value.versions.length > 0);
          }
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
  }, [onInstalledChange]);
  async function run(operation: () => Promise<void>) {
    if (operationBusy) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      const next = await window.artemis.officeCapabilityStatus();
      setStatus(next);
      onInstalledChange?.(next.versions.length > 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      label={title}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="office-capability">
        <h2>
          <Icon size="lg">
            <ArtemisIcon name={hasInstallation ? "gear" : "push"} />
          </Icon>
          {title}
        </h2>
        <p>{hasInstallation ? t.manageDescription : t.shared}</p>
        {!status?.activeVersion ? (
          <p className="office-capability-hint">{t.lite}</p>
        ) : null}
        {error || status?.error ? (
          <InlineNotice tone="danger">{error ?? status?.error}</InlineNotice>
        ) : null}
        {status?.phase !== "idle" && status ? (
          <div className="office-capability-progress" role="status">
            <p>{t.working}</p>
            <progress
              max={status.totalBytes || 1}
              value={status.downloadedBytes}
            />
            <Button
              variant="quiet"
              onClick={() => void window.artemis.cancelOfficeCapability()}
            >
              {t.cancel}
            </Button>
          </div>
        ) : null}
        {status?.versions.map((version) => (
          <div className="office-version" key={version.version}>
            <div className="office-version-header">
              <div className="office-version-info">
                <strong>{version.active ? t.installed : t.inactive}</strong>
                <span className="office-capability-hint">
                  {version.version} · {(version.bytes / 1024 / 1024).toFixed(1)}{" "}
                  MiB
                </span>
              </div>
              <div className="office-actions">
                {!version.active ? (
                  <Button
                    variant="quiet"
                    disabled={operationBusy}
                    onClick={() =>
                      void run(() =>
                        window.artemis.activateOfficeCapability(
                          version.version,
                        ),
                      )
                    }
                  >
                    {t.rollback}
                  </Button>
                ) : null}
                <Button
                  variant="quiet"
                  icon={<ArtemisIcon name="trash" />}
                  disabled={operationBusy || version.inUse}
                  aria-describedby={`office-remove-${version.version}`}
                  onClick={() =>
                    void run(() =>
                      window.artemis.uninstallOfficeCapability(version.version),
                    )
                  }
                >
                  {t.remove}
                </Button>
              </div>
            </div>
            <p
              className="office-capability-hint"
              id={`office-remove-${version.version}`}
            >
              {version.inUse ? t.inUse : t.removeHint}
            </p>
          </div>
        ))}
        {hasInstallation ? (
          <div className="office-capability-footer">
            {status?.updateCheck === "error" ? (
              <InlineNotice tone="danger">{t.checkFailed}</InlineNotice>
            ) : null}
            <div className="office-capability-hint" role="status">
              {status?.updateVersion ? (
                <p>
                  {t.updateAvailable.replace("{version}", status.updateVersion)}
                </p>
              ) : !status?.canCheckUpdates ? (
                <p>{t.updatesUnavailable}</p>
              ) : status.updateCheck === "checked" ? (
                <p>{status.availableVersion ? t.upToDate : t.noUpdates}</p>
              ) : null}
            </div>
            <div className="office-actions">
              {status?.updateVersion ? (
                <Button
                  variant="primary"
                  icon={<ArtemisIcon name="download" />}
                  disabled={operationBusy}
                  onClick={() =>
                    void run(() => window.artemis.installOfficeCapability())
                  }
                >
                  {t.updateNow.replace("{version}", status.updateVersion)}
                </Button>
              ) : null}
              <Button
                icon={<ArtemisIcon name="refresh" />}
                disabled={operationBusy || !status?.canCheckUpdates}
                onClick={() =>
                  void run(() => window.artemis.checkOfficeCapabilityUpdates())
                }
              >
                {checking ? t.checkingUpdates : t.checkUpdates}
              </Button>
              <Button variant="quiet" onClick={onClose}>
                {t.close}
              </Button>
            </div>
            <details className="office-capability-maintenance">
              <summary>{t.offlineMaintenance}</summary>
              <p className="office-capability-hint">
                {t.offlineMaintenanceHint}
              </p>
              <Button
                icon={<ArtemisIcon name="folder-open" />}
                disabled={operationBusy}
                onClick={() =>
                  void run(() => window.artemis.importOfficeCapability())
                }
              >
                {t.selectOfflinePack}
              </Button>
            </details>
          </div>
        ) : (
          <div className="office-capability-footer">
            {status && !status.availableVersion ? (
              <p className="office-capability-hint">{t.unavailable}</p>
            ) : null}
            <div className="office-actions">
              {status?.availableVersion ? (
                <Button
                  variant="primary"
                  icon={<ArtemisIcon name="download" />}
                  disabled={operationBusy}
                  onClick={() =>
                    void run(() => window.artemis.installOfficeCapability())
                  }
                >
                  {t.install}
                </Button>
              ) : null}
              <Button
                variant={status?.availableVersion ? "secondary" : "primary"}
                icon={<ArtemisIcon name="folder-open" />}
                disabled={operationBusy || !status}
                onClick={() =>
                  void run(() => window.artemis.importOfficeCapability())
                }
              >
                {t.offline}
              </Button>
              <Button variant="quiet" onClick={onClose}>
                {t.close}
              </Button>
            </div>
            <p className="office-capability-hint">{t.offlineHint}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
