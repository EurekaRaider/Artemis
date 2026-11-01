import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppLocale } from "@artemis/protocol";
import type { ReleaseUpdateStatus } from "../../shared/api.js";
import { Button } from "@artemis/ui/actions";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";

export function SidebarUpdateControl({
  status,
  locale,
  activeTaskCount,
  noticeTarget,
  onStatus,
  onError,
  showDownloadProgress = true,
}: {
  status: ReleaseUpdateStatus;
  locale: AppLocale;
  activeTaskCount: number;
  noticeTarget?: HTMLElement | null;
  onStatus(status: ReleaseUpdateStatus): void;
  onError(message: string): void;
  showDownloadProgress?: boolean;
}) {
  const [installing, setInstalling] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string>();
  const inFlight = useRef(false);
  const install = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWaiting(false);
    setInstalling(true);
    try {
      await window.artemis.installUpdate();
    } catch (error) {
      setInstalling(false);
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
    }
  }, [onError]);
  useEffect(() => {
    if (status.state !== "downloaded") {
      setWaiting(false);
      return;
    }
    if (waiting && activeTaskCount === 0) void install();
  }, [waiting, activeTaskCount, status.state, install]);
  if (["idle", "disabled"].includes(status.state)) return null;
  const progress = Math.max(0, Math.min(100, status.progress ?? 0));
  const label =
    status.state === "checking"
      ? uiText(locale, "Update.checking")
      : status.state === "downloading"
        ? `${Math.round(progress)}%`
        : status.state === "downloaded"
          ? uiText(locale, installing ? "Update.installing" : "Update.install")
          : status.manualUpdate
            ? uiText(locale, "Update.manualDownload")
            : status.state === "error"
              ? uiText(locale, "App_copy.queueRetry")
              : uiText(locale, "Update.toVersion", {
                  version: status.availableVersion ?? status.currentVersion,
                });
  const updateButton = (
    <Button
      className={`update-btn${status.state === "downloaded" ? " downloaded" : ""}`}
      disabled={
        installing ||
        waiting ||
        status.state === "checking" ||
        status.state === "downloading"
      }
      variant={status.state === "downloaded" ? "primary" : "quiet"}
      onClick={async () => {
        if (inFlight.current) return;
        if (status.manualDownloadUrl) {
          window.open(
            status.manualDownloadUrl,
            "_blank",
            "noopener,noreferrer",
          );
          return;
        }
        if (status.state === "downloaded") {
          if (activeTaskCount > 0) {
            setDismissedVersion(undefined);
            setWaiting(true);
          } else await install();
          return;
        }
        inFlight.current = true;
        try {
          onStatus(
            await (status.availableVersion
              ? window.artemis.downloadUpdate()
              : window.artemis.checkForUpdates()),
          );
        } catch (error) {
          onError(error instanceof Error ? error.message : String(error));
        } finally {
          inFlight.current = false;
        }
      }}
      icon={
        status.state === "downloading" ? (
          <span className="update-progress-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <circle
                cx="12"
                cy="12"
                r="10"
                pathLength="100"
                strokeDasharray={`${progress} 100`}
              />
            </svg>
            <ArtemisIcon name="arrow-down" />
          </span>
        ) : status.state === "checking" ? (
          <span className="update-checking-icon" aria-hidden="true" />
        ) : (
          <ArtemisIcon
            className={
              status.state === "available" ? "update-available-icon" : undefined
            }
            name={
              status.state === "downloaded"
                ? "update-ready"
                : status.state === "error"
                  ? "alert"
                  : "update"
            }
          />
        )
      }
    >
      {label}
    </Button>
  );
  const readyVersion = status.availableVersion ?? status.currentVersion;
  const notice =
    status.state === "downloaded" &&
    activeTaskCount > 0 &&
    dismissedVersion !== readyVersion ? (
      <div className="update-task-notice" role="status">
        <ArtemisIcon name="download" />
        <span className="update-task-notice-copy">
          <span>
            {uiText(locale, "Update.readyWithTasks", {
              version: readyVersion,
              count: activeTaskCount,
            })}
          </span>
          <span>{uiText(locale, "Update.waitingForTasks")}</span>
        </span>
        <Button
          size="compact"
          variant="quiet"
          onClick={() => {
            setWaiting(false);
            setDismissedVersion(readyVersion);
          }}
        >
          {uiText(locale, "Update.later")}
        </Button>
        {noticeTarget ? updateButton : null}
      </div>
    ) : null;
  return (
    <div
      className="sidebar-update"
      data-state={status.state}
      role={installing ? "status" : undefined}
    >
      {noticeTarget && notice ? null : updateButton}
      {showDownloadProgress &&
        status.state === "downloading" &&
        status.downloadedBytes !== undefined &&
        status.totalBytes !== undefined && (
          <span className="update-byte-count">
            {(status.downloadedBytes / 1048576).toLocaleString(locale, {
              maximumFractionDigits: 1,
            })}{" "}
            /{" "}
            {(status.totalBytes / 1048576).toLocaleString(locale, {
              maximumFractionDigits: 1,
            })}{" "}
            MB
          </span>
        )}
      {notice && noticeTarget ? createPortal(notice, noticeTarget) : notice}
      {(status.state === "error" ||
        (status.state === "downloaded" && status.message)) && (
        <div className="update-failure" role="alert">
          <ArtemisIcon name="alert" width={18} height={18} />
          <div>
            <strong>{uiText(locale, "Review01.updateFailed")}</strong>
            {status.rollbackAvailable && (
              <p>{UI_COPY.SettingsPanel_labels[locale].rollbackReady}</p>
            )}
            {status.message && (
              <details>
                <summary>{uiText(locale, "Review01.viewDetails")}</summary>
                <p>{status.message}</p>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function sidebarUpdateSubtitle(
  status: ReleaseUpdateStatus,
  locale: AppLocale,
): string {
  if (
    status.state === "downloading" &&
    status.downloadedBytes !== undefined &&
    status.totalBytes !== undefined
  ) {
    const format = (bytes: number) =>
      (bytes / 1048576).toLocaleString(locale, { maximumFractionDigits: 1 });
    return `${format(status.downloadedBytes)} / ${format(status.totalBytes)} MB`;
  }
  if (status.state === "downloaded")
    return uiText(locale, "Review01.readyVersion", {
      version: status.availableVersion ?? status.currentVersion,
    });
  if (status.state === "error") return uiText(locale, "Review01.updateFailed");
  return `v${status.currentVersion}${status.upToDate ? ` · ${uiText(locale, "Review01.upToDate")}` : ""}`;
}
