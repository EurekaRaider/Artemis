import { isExecutionMode } from "@artemis/protocol";

import { type ExecutionGrant } from "@artemis/protocol";

import { Checkbox, Select } from "@artemis/ui/forms";

import { type AuthorizationDraft } from "../im-authorization-draft";

interface CreateGroupPolicyRenderersContext {
  readonly draft: AuthorizationDraft | undefined;
  readonly active:
    | {
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
      }
    | undefined;
  readonly change: (patch: Partial<AuthorizationDraft>) => void;
  readonly t: import("../../../shared/i18n/ui-text").UiTranslate;
  readonly locked: boolean;
  readonly fullLocal: boolean;
  readonly expiration: (value: number) => string;
}
export function createGroupPolicyRenderers(
  context: CreateGroupPolicyRenderersContext,
) {
  const { draft, active, change, t, locked, fullLocal, expiration } = context;
  function policyFields() {
    if (!draft || !active) return null;
    const edit = (patch: Partial<typeof active>) =>
      change({ editPolicy: true, grant: { ...active, ...patch } });
    return (
      <div className="im-field-stack im-group-policy-fields">
        <Select
          label={t("AutomationPage_text.mode")}
          labelVisibility="visible"
          value={active.mode}
          disabled={locked}
          options={[
            { value: "plan", label: t("App_copy.plan") },
            { value: "work", label: t("App_copy.work") },
            { value: "codemode", label: t("App_copy.codemode") },
          ]}
          onValueChange={(value) => edit({ mode: value as typeof active.mode })}
        />
        <Select
          label={t("ImSettingsPanel.message143")}
          labelVisibility="visible"
          disabled={locked || fullLocal}
          value={fullLocal ? "automatic" : active.approval}
          options={[
            { value: "ask", label: t("ImSettingsPanel.message144") },
            { value: "automatic", label: t("ImSettingsPanel.message145") },
          ]}
          onValueChange={(value) =>
            edit({ approval: value as typeof active.approval })
          }
        />
        {isExecutionMode(active.mode) && !fullLocal && (
          <>
            <Checkbox
              label={t("ImSettingsPanel.message147")}
              disabled={locked}
              checked={active.shell}
              onCheckedChange={(shell) => edit({ shell })}
            />
            <Checkbox
              label={t("ImSettingsPanel.message148")}
              disabled={locked}
              checked={active.network}
              onCheckedChange={(network) => edit({ network })}
            />
          </>
        )}
        <label>
          <span>{t("GroupAuthorization.expiration")}</span>
          <input
            aria-label={t("GroupAuthorization.expiration")}
            type="datetime-local"
            disabled={locked}
            value={new Date(
              active.expiresAt -
                new Date(active.expiresAt).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)}
            onChange={(event) => {
              const date = new Date(event.target.value).getTime();
              if (Number.isFinite(date)) edit({ expiresAt: date });
            }}
          />
        </label>
      </div>
    );
  }
  function policySummary(value: ExecutionGrant | undefined, compact = false) {
    return (
      value && (
        <p title={compact ? expiration(value.expiresAt) : undefined}>
          {t(`App_copy.${value.mode}`)} ·{" "}
          {t(
            value.approval === "ask"
              ? "ImSettingsPanel.message144"
              : "ImSettingsPanel.message145",
          )}{" "}
          {!compact && <> · {expiration(value.expiresAt)}</>}
        </p>
      )
    );
  }
  return { policyFields, policySummary };
}
