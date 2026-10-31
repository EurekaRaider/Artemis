import {
  imScopeConfirmation,
  isExecutionMode,
  type AppLocale,
  type ImGroupContext,
  type Project,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { EnvironmentSection } from "@artemis/ui/workflow";
import { uiTranslator } from "../../shared/i18n/ui-text.js";
import type { ThreadConnection } from "./ImThreadConnection.js";
import { imChannelLabel } from "./ImNavigation.js";

export function ImGroupContextSummary({
  group,
  connection,
  project,
  locale,
  onManageAuthorization,
}: {
  group: ImGroupContext;
  connection?: ThreadConnection | undefined;
  project: Project;
  locale: AppLocale;
  onManageAuthorization?: ((trigger: HTMLButtonElement) => void) | undefined;
}) {
  const t = uiTranslator(locale);
  const known =
    !group.stale && connection && connection.connectionState !== "unknown";
  const grant = known
    ? connection.groupGrants?.find((item) => item.projectId === project.id)
    : undefined;
  const scope = grant?.security?.scopes.find(
    (item) => item.audience === `space:${group.spaceId}`,
  );
  const channel = connection?.channel;
  const channelLabel =
    channel === "feishu" || channel === "slack" || channel === "wecom"
      ? imChannelLabel(channel, t)
      : (channel ?? "IM");
  const connectionLabel = !known
    ? t("ImGroupMembers.message6")
    : connection.connectionState === "connected"
      ? t("ImNavigation.message12")
      : connection.connectionState === "connecting"
        ? t("ImNavigation.message11")
        : connection.connectionState === "error"
          ? t("ImNavigation.message8")
          : connection.connectionState === "removed"
            ? t("ImThreadConnection.removedBadge")
            : t("CustomAgentsSettingsSection_labels.disabledBadge");
  const authorizationLabel = !known
    ? t("ImGroupMembers.message6")
    : group.retired || !group.confirmed
      ? t("GroupAuthorization.paused")
      : !connection.serviceEnabled
        ? t("GroupAuthorization.saved")
        : connection.connectionState !== "connected"
          ? t("GroupAuthorization.connecting")
          : connection.permissionBlock
            ? t("ImPermission.waiting")
            : !grant || !scope
              ? t("GroupAuthorization.review")
              : !isExecutionMode(grant.mode)
                ? t("GroupAuthorization.readOnly")
                : !imScopeConfirmation(grant.security, scope)
                  ? t("GroupAuthorization.writePending")
                  : t("GroupAuthorization.executable");
  return (
    <>
      <EnvironmentSection
        className="im-group-context"
        title={t("GroupContext.channel")}
      >
        <div className="im-group-channel">
          <ArtemisIcon name="message" />
          <span title={`${channelLabel} · ${group.name}`}>
            {channelLabel} · {group.name}
          </span>
          <small data-state={known ? connection.connectionState : "unknown"}>
            {connectionLabel}
          </small>
        </div>
      </EnvironmentSection>
      <EnvironmentSection
        className="im-group-context"
        title={t("GroupContext.authorization")}
      >
        <strong className="im-group-project" title={project.name}>
          {project.name}
        </strong>
        <p className="im-group-context-note" role="status">
          {authorizationLabel}
        </p>
        {grant && (
          <dl className="im-group-context-details">
            <div>
              <dt>
                <ArtemisIcon name="plan" />
                {t("AutomationPage_text.mode")}
              </dt>
              <dd>
                {t(
                  grant.mode === "plan"
                    ? "ComposerMode.plan"
                    : grant.mode === "codemode"
                      ? "ComposerMode.codemode"
                      : "ComposerMode.work",
                )}
              </dd>
            </div>
            <div>
              <dt>
                <ArtemisIcon name="sandbox" />
                {t("ImSettingsPanel.message143")}
              </dt>
              <dd>
                {t(
                  grant.approval === "ask"
                    ? "ImSettingsPanel.message144"
                    : "ImSettingsPanel.message145",
                )}
              </dd>
            </div>
          </dl>
        )}
      </EnvironmentSection>
      <EnvironmentSection
        className="im-group-context"
        title={t("GroupContext.visibleScope")}
      >
        {scope ? (
          scope.localAccess === "full" ? (
            <p className="im-group-context-note">
              {t("GroupAuthorization.fullLocalScope")}
            </p>
          ) : (
            <dl className="im-group-context-details im-group-context-scope">
              <div>
                <dt>
                  <ArtemisIcon name="eye" />
                  {t("GroupAuthorization.readScope")}
                </dt>
                <dd>
                  {scope.readPaths.length === 0
                    ? t("ImDataPermissions.projectScope")
                    : scope.readPaths.join(", ")}
                </dd>
              </div>
              <div>
                <dt>
                  <ArtemisIcon name="edit" />
                  {t("GroupAuthorization.writeScope")}
                </dt>
                <dd>
                  {scope.writeMode === "project"
                    ? t("ImDataPermissions.projectScope")
                    : scope.writePaths.length
                      ? scope.writePaths.join(", ")
                      : t("GroupAuthorization.denied")}
                </dd>
              </div>
            </dl>
          )
        ) : (
          <p className="im-group-context-note">
            {t("ImGroupMembers.message6")}
          </p>
        )}
        {onManageAuthorization && (
          <button
            className="im-group-manage"
            type="button"
            onClick={(event) => onManageAuthorization(event.currentTarget)}
          >
            <ArtemisIcon name="sandbox" />
            {t("GroupAuthorization.edit")}
          </button>
        )}
      </EnvironmentSection>
    </>
  );
}
