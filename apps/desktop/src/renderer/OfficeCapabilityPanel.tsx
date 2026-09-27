import { useEffect, useState } from "react";
import type { AppLocale, CapabilityPackStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
import { officeCopy } from "./office-copy.js";
import "./office-workbench.css";

export function OfficeCapabilityPanel({
  locale,
  onClose,
}: {
  locale: AppLocale;
  onClose(): void;
}) {
  const t = officeCopy(locale);
  const [status, setStatus] = useState<CapabilityPackStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.artemis
        .officeCapabilityStatus()
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
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      setStatus(await window.artemis.officeCapabilityStatus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      label={t.runtime}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="office-capability">
        <h2>{t.runtime}</h2>
        <p>{t.shared}</p>
        <p>{t.lite}</p>
        {!status?.availableVersion && !status?.activeVersion ? (
          <InlineNotice>{t.unavailable}</InlineNotice>
        ) : null}
        {error || status?.error ? (
          <InlineNotice tone="danger">{error ?? status?.error}</InlineNotice>
        ) : null}
        {status?.phase !== "idle" && status ? (
          <div role="status">
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
        {status?.dependents.length ? (
          <p>
            {t.sharedBy}: {status.dependents.join(", ")}
          </p>
        ) : null}
        {status?.versions.map((version) => (
          <div className="office-version" key={version.version}>
            <span>
              {version.active ? "● " : ""}
              {version.version} · {(version.bytes / 1024 / 1024).toFixed(1)} MiB
            </span>
            {!version.active ? (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.artemis.activateOfficeCapability(version.version),
                  )
                }
              >
                {t.rollback}
              </Button>
            ) : null}
            {version.active ? (
              <Button
                variant="quiet"
                disabled={busy || version.inUse}
                onClick={() =>
                  void run(() => window.artemis.deactivateOfficeCapability())
                }
              >
                {t.deactivate}
              </Button>
            ) : null}
            <Button
              variant="quiet"
              disabled={
                busy ||
                version.inUse ||
                (version.active && Boolean(status.dependents.length))
              }
              onClick={() =>
                void run(() =>
                  window.artemis.uninstallOfficeCapability(version.version),
                )
              }
            >
              {t.remove}
            </Button>
          </div>
        ))}
        <div className="office-actions">
          <Button
            disabled={busy || !status?.availableVersion}
            onClick={() =>
              void run(() => window.artemis.installOfficeCapability())
            }
          >
            {status?.activeVersion ? t.repair : t.install}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
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
      </div>
    </Dialog>
  );
}
