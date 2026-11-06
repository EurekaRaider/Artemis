import { type ImConnectionStatus } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";

import { ImSlackSetup, slackAppManifest } from "../ImSlackSetup";

import { type ImChannel } from "../ImNavigation";

import { ImPlatformSetup } from "../ImPlatformSetup";

import { ImFeishuScan } from "../ImFeishuScan";
import { ImLegacyImport } from "../ImLegacyImport";

interface CreateImChannelSetupRenderersContext {
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly busy: boolean;
  readonly activeSettings: {
    enabled: boolean;
    gatewayUrl: string;
    deviceId: string;
    deviceName: string;
    defaultProjectId: string;
    grants: {
      projectId: string;
      policyVersion?: string | undefined;
      tokenBudget?: number | undefined;
      approval: "ask" | "automatic";
      mode: "codemode" | "plan" | "work";
      network: boolean;
      shell: boolean;
      groups: string[];
      expiresAt: number;
      security?:
        | {
            version: 2;
            revision: string;
            confirmedAt: number;
            scopes: {
              audience: string;
              revision?: string | undefined;
              contextRevision?: string | undefined;
              confirmedAt?: number | undefined;
              localAccess?: "full" | "project" | undefined;
              readMode?: "project" | "selected" | undefined;
              writeMode?: "project" | "selected" | undefined;
              spaceRevision?: string | undefined;
              filePaths?: string[] | undefined;
              readPaths: string[];
              writePaths: string[];
            }[];
          }
        | undefined;
    }[];
  };
  readonly connectScannedBot: (
    connectionId: string | undefined,
    before?: () => void,
  ) => void;
  readonly connectionId: string;
  readonly channel: ImChannel;
  readonly feishuTransport: string;
  readonly feishuDomain: "feishu" | "lark";
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly local: boolean;
  readonly refresh: () => Promise<void>;
}
export function createImChannelSetupRenderers(
  context: CreateImChannelSetupRenderersContext,
) {
  const {
    t,
    busy,
    activeSettings,
    connectScannedBot,
    connectionId,
    channel,
    feishuTransport,
    feishuDomain,
    setMessage,
    run,
    local,
    refresh,
  } = context;
  const renderFeishuScan = (
    autoStart: boolean,
    domain: "feishu" | "lark",
    onScanConnected?: (connectionId?: string) => void,
  ) => (
    <ImFeishuScan
      key={domain}
      domain={domain}
      t={t}
      autoStart={autoStart}
      busy={busy}
      disabled={!activeSettings.deviceId}
      onConnected={(connectionId) => {
        connectScannedBot(connectionId, () => onScanConnected?.(connectionId));
      }}
    />
  );
  /* 平台接入指引：slack 恒为清单指引，飞书/企微走平台步骤。 */
  const renderGuideBody = () =>
    channel === "slack" ? (
      <ImSlackSetup
        t={t}
        busy={busy}
        copy={() =>
          void run(async () => {
            const { userName } = await window.artemis.getSnapshot();
            await navigator.clipboard.writeText(
              slackAppManifest(`${userName}_bot`),
            );
            setMessage(t("ImSettingsPanel.message60"));
          })
        }
      />
    ) : (
      <ImPlatformSetup
        channel={channel}
        transport={feishuTransport}
        domain={feishuDomain}
        t={t}
      />
    );
  const renderLegacyImport = () => (
    <ImLegacyImport
      key={activeSettings.deviceId}
      local={local}
      busy={busy}
      ready={!!activeSettings.deviceId}
      run={run}
      t={t}
      imported={async () => {
        await refresh();
        setMessage(t("ImSettingsPanel.message63"));
      }}
    />
  );
  /* 飞书 webhook 连接的回调地址：跟随机器人详情展示。 */
  const renderWebhookCallback = (connection: ImConnectionStatus) =>
    channel === "feishu" &&
    connection.configuration?.transport === "webhook" &&
    connection.callbackUrl ? (
      <div className="im-actions">
        <p className="im-identifier">
          {t("ImSettingsPanel.message98")}
          {connection.callbackUrl}
        </p>
        <Button
          variant="quiet"
          className="management-text-action"
          disabled={!activeSettings.gatewayUrl}
          onClick={() =>
            void run(async () => {
              await navigator.clipboard.writeText(connection.callbackUrl!);
              setMessage(t("ImSettingsPanel.message100"));
            })
          }
        >
          {t("ImSettingsPanel.message99")}
        </Button>
      </div>
    ) : null;
  return {
    renderFeishuScan,
    renderGuideBody,
    renderLegacyImport,
    renderWebhookCallback,
  };
}
