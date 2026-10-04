// Generic capability-pack management dialog (todo ⑤): one implementation for
// every capability pack (office-core, artemis-design, …). Consumers supply a
// typed API surface over the pack's IPC methods and a copy bundle; the flow —
// status polling, download progress, version list, update check, offline
// import — is identical across packs by design.
import { useEffect, useRef, useState } from "react";
import type { AppLocale, CapabilityPackStatus } from "@artemis/protocol";
import { Button, Icon } from "@artemis/ui/actions";
import { Dialog, InlineNotice } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
// 弹窗样式随组件加载：资源中心等主窗口入口也会打开它，不能依赖 Office
// 工作台的懒加载块。
import "./capability-pack.css";

export interface CapabilityPackCopy {
  runtime: string;
  manage: string;
  manageDescription: string;
  shared: string;
  lite: string;
  working: string;
  cancel: string;
  installed: string;
  inactive: string;
  rollback: string;
  remove: string;
  inUse: string;
  removeHint: string;
  checkFailed: string;
  updateAvailable: string;
  updateNow: string;
  upToDate: string;
  noUpdates: string;
  updatesUnavailable: string;
  checkUpdates: string;
  checkingUpdates: string;
  offlineMaintenance: string;
  selectOfflinePack: string;
  offlineMaintenanceHint: string;
  offlineHint: string;
  unavailable: string;
  install: string;
  offline: string;
  close: string;
}

export interface CapabilityPackApi {
  status(): Promise<CapabilityPackStatus>;
  checkUpdates(): Promise<void>;
  install(): Promise<void>;
  importOffline(): Promise<void>;
  cancel(): Promise<void>;
  activate(version: string): Promise<void>;
  uninstall(version: string): Promise<void>;
}

export function CapabilityPackPanel({
  copy,
  api,
  onClose,
  installed = false,
  onInstalledChange,
}: {
  copy: CapabilityPackCopy;
  api: CapabilityPackApi;
  onClose(): void;
  installed?: boolean;
  onInstalledChange?(installed: boolean): void;
}) {
  const [status, setStatus] = useState<CapabilityPackStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const hasInstallation = status ? status.versions.length > 0 : installed;
  const title = hasInstallation ? copy.manage : copy.runtime;
  const checking = status?.updateCheck === "checking";
  const operationBusy =
    busy || checking || Boolean(status && status.phase !== "idle");
  // 打开弹窗时的初始焦点应落在主操作（下载/导入离线包），而不是第一个
  // 可聚焦元素——离线场景下那是「关闭」，系统蓝焦点环会压在黑色主按钮
  // 旁边。主按钮在 status 加载前是 disabled，等它转可用后再聚焦；只在
  // 打开后的一小段时间内做这次接管，用户已自行操作时不抢焦点。
  const primaryActionsRef = useRef<HTMLDivElement>(null);
  const primaryFocused = useRef(false);
  const openedAt = useRef(Date.now());
  useEffect(() => {
    if (primaryFocused.current || hasInstallation) return;
    const button = primaryActionsRef.current?.querySelector<HTMLButtonElement>(
      "button[data-variant='primary']",
    );
    if (!button || button.disabled) return;
    primaryFocused.current = true;
    if (Date.now() - openedAt.current > 1500) return;
    button.focus({ preventScroll: true });
  });
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api
        .status()
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
  }, [api, onInstalledChange]);
  async function run(operation: () => Promise<void>) {
    if (operationBusy) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      const next = await api.status();
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
        <p>{hasInstallation ? copy.manageDescription : copy.shared}</p>
        {/* 「设计模式保持隐藏」只在已装未激活的修复/回滚语境有信息量；
            未安装分支已有 shared+unavailable 两行说明，再叠一行只是噪音。 */}
        {hasInstallation && !status?.activeVersion ? (
          <p className="office-capability-hint">{copy.lite}</p>
        ) : null}
        {error || status?.error ? (
          <InlineNotice tone="danger">{error ?? status?.error}</InlineNotice>
        ) : null}
        {status?.phase !== "idle" && status ? (
          <div className="office-capability-progress" role="status">
            <p>{copy.working}</p>
            <progress
              max={status.totalBytes || 1}
              value={status.downloadedBytes}
            />
            <Button variant="quiet" onClick={() => void api.cancel()}>
              {copy.cancel}
            </Button>
          </div>
        ) : null}
        {status?.versions.map((version) => (
          <div className="office-version" key={version.version}>
            <div className="office-version-header">
              <div className="office-version-info">
                <strong>
                  {version.active ? copy.installed : copy.inactive}
                </strong>
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
                      void run(() => api.activate(version.version))
                    }
                  >
                    {copy.rollback}
                  </Button>
                ) : null}
                <Button
                  variant="quiet"
                  icon={<ArtemisIcon name="trash" />}
                  disabled={operationBusy || version.inUse}
                  aria-describedby={`pack-remove-${version.version}`}
                  onClick={() => void run(() => api.uninstall(version.version))}
                >
                  {copy.remove}
                </Button>
              </div>
            </div>
            <p
              className="office-capability-hint"
              id={`pack-remove-${version.version}`}
            >
              {version.inUse ? copy.inUse : copy.removeHint}
            </p>
          </div>
        ))}
        {hasInstallation ? (
          <div className="office-capability-footer">
            {status?.updateCheck === "error" ? (
              <InlineNotice tone="danger">{copy.checkFailed}</InlineNotice>
            ) : null}
            <div className="office-capability-hint" role="status">
              {status?.updateVersion ? (
                <p>
                  {copy.updateAvailable.replace(
                    "{version}",
                    status.updateVersion,
                  )}
                </p>
              ) : !status?.canCheckUpdates ? (
                <p>{copy.updatesUnavailable}</p>
              ) : status.updateCheck === "checked" ? (
                <p>
                  {status.availableVersion ? copy.upToDate : copy.noUpdates}
                </p>
              ) : null}
            </div>
            <div className="office-actions">
              {status?.updateVersion ? (
                <Button
                  variant="primary"
                  icon={<ArtemisIcon name="download" />}
                  disabled={operationBusy}
                  onClick={() => void run(() => api.install())}
                >
                  {copy.updateNow.replace("{version}", status.updateVersion)}
                </Button>
              ) : null}
              <Button
                icon={<ArtemisIcon name="refresh" />}
                disabled={operationBusy || !status?.canCheckUpdates}
                onClick={() => void run(() => api.checkUpdates())}
              >
                {checking ? copy.checkingUpdates : copy.checkUpdates}
              </Button>
              <Button variant="quiet" onClick={onClose}>
                {copy.close}
              </Button>
            </div>
            <details className="office-capability-maintenance">
              <summary>{copy.offlineMaintenance}</summary>
              <p className="office-capability-hint">
                {copy.offlineMaintenanceHint}
              </p>
              <Button
                icon={<ArtemisIcon name="folder-open" />}
                disabled={operationBusy}
                onClick={() => void run(() => api.importOffline())}
              >
                {copy.selectOfflinePack}
              </Button>
            </details>
          </div>
        ) : (
          <div className="office-capability-footer">
            {status && !status.availableVersion ? (
              <p className="office-capability-hint">{copy.unavailable}</p>
            ) : null}
            <div className="office-actions" ref={primaryActionsRef}>
              {status?.availableVersion ? (
                <Button
                  variant="primary"
                  icon={<ArtemisIcon name="download" />}
                  disabled={operationBusy}
                  onClick={() => void run(() => api.install())}
                >
                  {copy.install}
                </Button>
              ) : null}
              <Button
                variant={status?.availableVersion ? "secondary" : "primary"}
                icon={<ArtemisIcon name="folder-open" />}
                disabled={operationBusy || !status}
                onClick={() => void run(() => api.importOffline())}
              >
                {copy.offline}
              </Button>
              <Button variant="quiet" onClick={onClose}>
                {copy.close}
              </Button>
            </div>
            <p className="office-capability-hint">{copy.offlineHint}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function packCopyFor(
  locale: AppLocale,
  translations: Partial<Record<AppLocale, CapabilityPackCopy>>,
  fallback: CapabilityPackCopy,
): CapabilityPackCopy {
  return translations[locale] ?? fallback;
}
