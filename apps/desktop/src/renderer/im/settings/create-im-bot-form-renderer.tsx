import { Button } from "@artemis/ui/actions";

import { InlineNotice } from "@artemis/ui/feedback";
import { Select, TextField } from "@artemis/ui/forms";

import { type ImChannel } from "../ImNavigation";

interface CreateImBotFormRendererContext {
  readonly channel: ImChannel;
  readonly t: import("../../../shared/i18n/ui-text.js").UiTranslate;
  readonly feishuDomain: "feishu" | "lark";
  readonly busy: boolean;
  readonly setFields: import("react").Dispatch<
    import("react").SetStateAction<Record<string, string>>
  >;
  readonly renderBotField: (field: string) => import("react").JSX.Element;
  readonly requiredFields: string[];
  readonly feishuTransport: string;
  readonly optionalFields: string[];
  readonly local: boolean;
  readonly adminToken: string;
  readonly setAdminToken: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
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
  readonly fields: Record<string, string>;
  readonly saveBotForm: (dismiss: (savedId: string) => void) => void;
}
export function createImBotFormRenderer(
  context: CreateImBotFormRendererContext,
) {
  const {
    channel,
    t,
    feishuDomain,
    busy,
    setFields,
    renderBotField,
    requiredFields,
    feishuTransport,
    optionalFields,
    local,
    adminToken,
    setAdminToken,
    activeSettings,
    fields,
    saveBotForm,
  } = context;
  const renderBotForm = (cancel: (savedId: string) => void) => (
    <>
      {channel === "feishu" && (
        <Select
          labelVisibility="visible"
          label={t("ImSettingsPanel.message78")}
          description={t("ImSettingsPanel.message79")}
          value={feishuDomain}
          options={[
            {
              value: "feishu",
              label: t("ImSettingsPanel.message80"),
            },
            {
              value: "lark",
              label: t("ImSettingsPanel.message81"),
            },
          ]}
          disabled={busy}
          onValueChange={(domain) =>
            setFields((previous) => ({ ...previous, domain }))
          }
        />
      )}
      {requiredFields.map(renderBotField)}
      <details className="im-advanced-fields">
        <summary>{t("ImSettingsPanel.message82")}</summary>
        <div className="im-field-stack">
          {channel === "feishu" && (
            <Select
              labelVisibility="visible"
              label={t("ImSettingsPanel.message83")}
              value={feishuTransport}
              options={[
                {
                  value: "websocket",
                  label: t("ImSettingsPanel.message84"),
                },
                {
                  value: "webhook",
                  label: t("ImSettingsPanel.message85"),
                },
              ]}
              disabled={busy}
              onValueChange={(transport) =>
                setFields((previous) => ({
                  ...previous,
                  transport,
                }))
              }
            />
          )}
          {optionalFields.map(renderBotField)}
        </div>
      </details>
      {!local && (
        <TextField
          label={t("ImSettingsPanel.message86")}
          type="password"
          value={adminToken}
          onValueChange={setAdminToken}
          autoComplete="off"
          disabled={busy}
          description={t("ImSettingsPanel.message87")}
        />
      )}
      {channel === "feishu" && feishuTransport === "webhook" && local && (
        <InlineNotice tone="info">
          {t("ImSettingsPanel.message88")}
        </InlineNotice>
      )}
      <div className="im-actions">
        <Button
          disabled={
            busy ||
            (!local && !adminToken) ||
            !activeSettings.deviceId ||
            (local && channel === "feishu" && feishuTransport === "webhook") ||
            !requiredFields.every((key) => fields[key]?.trim())
          }
          onClick={() => saveBotForm(cancel)}
        >
          {t("ImSettingsPanel.message89")}
        </Button>
        <Button disabled={busy} onClick={() => cancel("")}>
          {t("App_copy.renameCancel")}
        </Button>
      </div>
    </>
  );
  return { renderBotForm };
}
