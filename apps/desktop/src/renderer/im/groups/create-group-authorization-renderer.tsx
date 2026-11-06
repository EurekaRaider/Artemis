import { type GroupChoice, type Status } from "./group-values.js";
import { isExecutionMode } from "@artemis/protocol";

import {
  imScopeConfirmation,
  type ExecutionGrant,
  type ImConnectionStatus,
} from "@artemis/protocol";
import {
  ArrowsLeftRight,
  FolderSimple,
  Pause,
  ShieldCheck,
} from "@phosphor-icons/react";

import { ArtemisIcon } from "@artemis/ui/icons";
import { Button } from "@artemis/ui/actions";

import { InlineNotice } from "@artemis/ui/feedback";

import {
  type AuthorizationDraft,
  type AuthorizationTarget,
} from "../im-authorization-draft";

interface CreateGroupAuthorizationRendererContext {
  readonly status: Status;
  readonly botName: (target: GroupChoice) => string;
  readonly locked: boolean;
  readonly t: import("../../../shared/i18n/ui-text").UiTranslate;
  readonly projects: {
    id: string;
    name: string;
    path: string;
    createdAt: string;
    updatedAt: string;
  }[];
  readonly policySummary: (
    value: ExecutionGrant | undefined,
    compact?: boolean,
  ) => import("react").JSX.Element | undefined;
  readonly begin: (
    target: AuthorizationTarget | undefined,
    projectId: string,
    intent: AuthorizationDraft["intent"],
    entry?: AuthorizationDraft["entry"],
  ) => void;
  readonly key: (group: AuthorizationTarget) => string;
}
export function createGroupAuthorizationRenderer(
  context: CreateGroupAuthorizationRendererContext,
) {
  const { status, botName, locked, t, projects, policySummary, begin, key } =
    context;
  function authorizationRow(target: GroupChoice) {
    const saved = target.saved;
    const grant = status.settings.grants.find(
      (item) => item.projectId === saved?.nativeGroup?.projectId,
    );
    const scope = grant?.security?.scopes.find(
      (item) => item.audience === target.value,
    );
    const name = botName(target);
    const connection = (
      status.connections as ImConnectionStatus[] | undefined
    )?.find((c) => c.id === target.conversation.connectionId);
    const state = !saved
      ? "unbound"
      : !saved.nativeGroup?.enabled
        ? saved.nativeGroup?.recovery?.rejoinedAt
          ? "rejoined"
          : saved.nativeGroup?.recovery
            ? "removed"
            : "paused"
        : !status.settings.enabled
          ? "saved"
          : connection?.state !== "connected"
            ? "connecting"
            : !grant || !scope || grant.expiresAt <= Date.now()
              ? "review"
              : !isExecutionMode(grant.mode)
                ? "readOnly"
                : !imScopeConfirmation(grant.security, scope)
                  ? "writePending"
                  : "executable";
    const task = status.remoteTasks?.find(
      (task) =>
        !!saved?.id &&
        !task.parentThreadId &&
        task.currentGroupEntry !== false &&
        task.group?.spaceId === saved?.id,
    );
    const disabled =
      locked ||
      status.authorizationVersion !== 1 ||
      !status.localGateway ||
      !target.owner;
    return (
      <section
        className="im-group-bot-authorization"
        aria-label={name}
        key={key(target)}
      >
        <header className="im-group-bot-identity">
          <span className="im-group-bot-avatar">
            <ArtemisIcon name="bot" width={24} height={24} />
          </span>
          <div className="im-group-bot-name">
            <h4>{name}</h4>
            <span className="im-group-status" data-state={state}>
              {t(`GroupAuthorization.${state}`)}
            </span>
          </div>
        </header>
        <div className="im-group-bot-permissions">
          {saved?.nativeGroup?.projectId && (
            <p className="im-group-project-name">
              <FolderSimple size={16} weight="duotone" aria-hidden="true" />
              {projects.find(
                (project) => project.id === saved.nativeGroup!.projectId,
              )?.name ?? t("GroupAuthorization.nameUnavailable")}
            </p>
          )}
          {policySummary(
            scope?.localAccess === "full" && grant
              ? { ...grant, approval: "automatic" }
              : grant,
            true,
          )}
          {scope && (
            <dl className="im-group-summary">
              <dt>{t("GroupAuthorization.readScope")}</dt>
              <dd>
                {scope.localAccess === "full"
                  ? t("GroupAuthorization.fullLocal")
                  : scope.readPaths.length
                    ? scope.readPaths.join(" · ")
                    : t("ImDataPermissions.projectScope")}
              </dd>
              <dt>{t("GroupAuthorization.writeScope")}</dt>
              <dd>
                {!isExecutionMode(grant?.mode)
                  ? t("GroupAuthorization.denied")
                  : scope.localAccess === "full"
                    ? t("GroupAuthorization.fullLocal")
                    : scope.writeMode === "project"
                      ? t("ImDataPermissions.message14")
                      : scope.writePaths.join(" · ") ||
                        t("GroupAuthorization.denied")}
              </dd>
            </dl>
          )}
          {!task && (
            <p className="im-group-first-message">
              {t("GroupAuthorization.firstMessage")}
            </p>
          )}
        </div>
        <div className="im-group-bot-actions">
          <Button
            variant="primary"
            size="comfortable"
            icon={<ShieldCheck weight="duotone" aria-hidden="true" />}
            disabled={disabled}
            onClick={() =>
              begin(
                target,
                saved?.nativeGroup?.projectId ?? "",
                !saved
                  ? "create"
                  : !saved.nativeGroup?.enabled
                    ? "restore"
                    : grant && grant.expiresAt <= Date.now()
                      ? "renew"
                      : "edit",
                "group",
              )
            }
          >
            {t(
              !saved
                ? "GroupAuthorization.authorize"
                : !saved.nativeGroup?.enabled
                  ? "GroupAuthorization.restore"
                  : "GroupAuthorization.edit",
            )}
          </Button>
          {saved && (
            <>
              <Button
                size="comfortable"
                icon={<ArrowsLeftRight aria-hidden="true" />}
                disabled={disabled}
                onClick={() =>
                  begin(target, saved.nativeGroup!.projectId, "rebind", "group")
                }
              >
                {t("GroupAuthorization.rebind")}
              </Button>
              {saved.nativeGroup?.enabled && (
                <Button
                  size="comfortable"
                  icon={<Pause aria-hidden="true" />}
                  disabled={disabled}
                  onClick={() =>
                    begin(
                      target,
                      saved.nativeGroup!.projectId,
                      "pause",
                      "group",
                    )
                  }
                >
                  {t("GroupAuthorization.pause")}
                </Button>
              )}
            </>
          )}
        </div>
        {!target.owner && (
          <InlineNotice tone="warning">
            {t("GroupAuthorization.ownerRequired")}
          </InlineNotice>
        )}
      </section>
    );
  }
  return { authorizationRow };
}
