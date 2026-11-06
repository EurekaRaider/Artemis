import { officeCopy } from "../office/office-copy.js";
import {
  labels,
  TrashIcon,
  installedCapabilityVersion,
} from "./resource-presentation.js";

import designPluginIcon from "../assets/design-plugin-icon.svg";
import officeSuiteIcon from "../assets/office-suite-icon.svg";

import { designPackCopy } from "../design/design-pack-copy.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import type { AppLocale, CapabilityPackStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

import { ManagementCard } from "@artemis/ui/management";

import { ArtemisIcon } from "@artemis/ui/icons";
import { ResourceAvatar } from "./resource-icons.js";
interface CapabilityCardRenderersDependencies {
  officePackStatus: CapabilityPackStatus | undefined;
  officeUpdating: boolean;
  setOfficeUpdating: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  setOfficePackStatus: import("react").Dispatch<
    import("react").SetStateAction<CapabilityPackStatus | undefined>
  >;
  setOfficeCapabilityActive: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  setOfficeCapabilityInstalled: import("react").Dispatch<
    import("react").SetStateAction<boolean | undefined>
  >;
  runResourceOperation: (operation: () => Promise<void>) => void;
  office: ReturnType<typeof officeCopy>;
  t: (typeof labels)[import("@artemis/protocol").AppLocale];
  setOfficeCapabilityOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  locale:
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW";
  designPackStatus: CapabilityPackStatus | undefined;
  setDesignPackStatus: import("react").Dispatch<
    import("react").SetStateAction<CapabilityPackStatus | undefined>
  >;
  designPackInstalled: boolean;
  operationPending: boolean;
  setDesignPackOpen: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
}
export function createCapabilityCardRenderers({
  officePackStatus,
  officeUpdating,
  setOfficeUpdating,
  setOfficePackStatus,
  setOfficeCapabilityActive,
  setOfficeCapabilityInstalled,
  runResourceOperation,
  office,
  t,
  setOfficeCapabilityOpen,
  locale,
  designPackStatus,
  setDesignPackStatus,
  designPackInstalled,
  operationPending,
  setDesignPackOpen,
}: CapabilityCardRenderersDependencies) {
  function renderOfficePackCard() {
    const status = officePackStatus;
    const installedVersion = installedCapabilityVersion(status);
    const installed = Boolean(status?.versions.length);
    const working =
      officeUpdating || Boolean(status && status.phase !== "idle");
    const run = (operation: () => Promise<void>) =>
      runResourceOperation(async () => {
        setOfficeUpdating(true);
        try {
          await operation();
          const status = await window.artemis.officeCapabilityStatus();
          setOfficePackStatus(status);
          setOfficeCapabilityActive(Boolean(status.activeVersion));
          setOfficeCapabilityInstalled(status.versions.length > 0);
          window.dispatchEvent(new Event("artemis:resources-changed"));
        } finally {
          setOfficeUpdating(false);
        }
      });
    return (
      <ManagementCard className="plugin-market-card office-pack-card">
        <div className="plugin-market-card-heading">
          <ResourceAvatar
            kind="plugin"
            name="office"
            iconDataUrl={officeSuiteIcon}
          />
          <div className="plugin-market-card-titles">
            <strong>
              {"Office"}
              <span className="plugin-market-card-vn">
                {installedVersion ? `v${installedVersion}` : ""}
              </span>
            </strong>
          </div>
        </div>
        <div className="plugin-market-copy">
          <small>{office.shared}</small>
        </div>
        <div className="plugin-market-card-footer">
          <details
            className="plugin-market-card-actions"
            data-installed={installed}
            open={working || !installed ? true : undefined}
          >
            <summary>
              <ArtemisIcon name="check" width={14} height={14} />
              {t.installed}
            </summary>
            <div className="plugin-card-menu-body">
              {working ? (
                <>
                  <progress
                    aria-label={office.working}
                    max={status?.totalBytes || 1}
                    value={status?.downloadedBytes}
                  />
                  <Button
                    variant="quiet"
                    onClick={() => void window.artemis.cancelOfficeCapability()}
                  >
                    {office.cancel}
                  </Button>
                </>
              ) : installed ? (
                <>
                  {status?.updateVersion && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(() => window.artemis.installOfficeCapability())
                      }
                    >
                      {office.updateNow.replace(
                        "{version}",
                        status.updateVersion,
                      )}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="management-destructive-action plugin-market-remove-action"
                    icon={<TrashIcon />}
                    disabled={status?.versions.some((version) => version.inUse)}
                    title={
                      status?.versions.some((version) => version.inUse)
                        ? office.inUse
                        : undefined
                    }
                    onClick={() =>
                      run(() => window.artemis.uninstallOfficeCapability())
                    }
                  >
                    {office.remove}
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() =>
                    status?.availableVersion
                      ? run(() => window.artemis.installOfficeCapability())
                      : setOfficeCapabilityOpen(true)
                  }
                >
                  {t.install}
                </Button>
              )}
            </div>
          </details>
        </div>
      </ManagementCard>
    );
  }

  function renderDesignPackCard() {
    const copy = designPackCopy(locale);
    const status = designPackStatus;
    const installedVersion = installedCapabilityVersion(status);
    const installed = Boolean(status?.versions.length);
    const working = Boolean(status && status.phase !== "idle");
    const run = (operation: () => Promise<void>) =>
      runResourceOperation(async () => {
        await operation();
        setDesignPackStatus(await window.artemis.designCapabilityStatus());
        window.dispatchEvent(new Event("artemis:resources-changed"));
      });
    return (
      <ManagementCard className="plugin-market-card design-pack-card">
        <div className="plugin-market-card-heading">
          <ResourceAvatar
            kind="plugin"
            name="design"
            iconDataUrl={designPluginIcon}
          />
          <div className="plugin-market-card-titles">
            <strong
              title={`${uiText(
                locale,
                "App_copy.designTab",
              )}${installedVersion ? ` v${installedVersion}` : ""}`}
            >
              {uiText(locale, "App_copy.designTab")}
              {/* 与通用卡一致：已安装时在名称后跟小号 v+版本号。 */}
              {designPackInstalled && installedVersion && (
                <span className="plugin-market-card-vn">
                  v{installedVersion}
                </span>
              )}
            </strong>
          </div>
        </div>
        <div className="plugin-market-copy">
          <small>{copy.manageDescription}</small>
        </div>
        <div className="plugin-market-card-footer">
          <details
            className="plugin-market-card-actions"
            data-installed={installed}
            open={working || !installed ? true : undefined}
          >
            <summary>
              <ArtemisIcon name="check" width={14} height={14} />
              {t.installed}
            </summary>
            <div className="plugin-card-menu-body">
              {working ? (
                <div
                  className="office-capability-progress"
                  role="status"
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <progress
                    max={status?.totalBytes || 1}
                    value={status?.downloadedBytes}
                    style={{ width: 140 }}
                  />
                  <Button
                    variant="quiet"
                    size="compact"
                    onClick={() => void window.artemis.cancelDesignCapability()}
                  >
                    {copy.cancel}
                  </Button>
                </div>
              ) : installed ? (
                <>
                  {status?.updateVersion ? (
                    <Button
                      className="plugin-market-update-action"
                      variant="secondary"
                      size="compact"
                      disabled={operationPending}
                      onClick={() =>
                        run(() => window.artemis.installDesignCapability())
                      }
                    >
                      {copy.updateNow.replace(
                        "{version}",
                        status.updateVersion,
                      )}
                    </Button>
                  ) : null}
                  <Button
                    className="management-destructive-action plugin-market-remove-action"
                    icon={<TrashIcon />}
                    variant="secondary"
                    disabled={
                      operationPending ||
                      status?.versions.some((version) => version.inUse)
                    }
                    title={
                      status?.versions.some((version) => version.inUse)
                        ? copy.inUse
                        : undefined
                    }
                    onClick={() =>
                      run(() => window.artemis.uninstallDesignCapability())
                    }
                  >
                    {t.remove}
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  disabled={operationPending}
                  onClick={() => {
                    if (status?.availableVersion) {
                      run(() => window.artemis.installDesignCapability());
                      return;
                    }
                    // 无在线版本：管理弹窗承载离线导入路径。
                    setDesignPackOpen(true);
                  }}
                >
                  {t.install}
                </Button>
              )}
            </div>
          </details>
        </div>
      </ManagementCard>
    );
  }
  return { renderOfficePackCard, renderDesignPackCard };
}
