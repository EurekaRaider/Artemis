import { type GroupChoice, type Status } from "./group-values.js";

import { imIdentityKey } from "@artemis/protocol";
import {
  ArrowClockwise,
  CaretRight,
  UsersThree,
  User,
} from "@phosphor-icons/react";

import { ArtemisIcon } from "@artemis/ui/icons";
import { Button } from "@artemis/ui/actions";

import {
  imGroupMemberStatus,
  imMemberLabel,
  imMemberTooltip,
} from "../im-group-member-status";

interface CreateGroupMemberRendererContext {
  readonly rosterFor: (target: GroupChoice) =>
    | {
        members: {
          identity: {
            channel: "feishu" | "slack" | "wecom";
            connectionId: string;
            tenantId: string;
            appId: string;
            userId: string;
          };
          name: string;
          kind: "bot" | "human" | "unknown";
          self?: boolean | undefined;
          presence?: "active" | "away" | "unknown" | undefined;
          presenceCheckedAt?: number | undefined;
          presenceError?:
            "missing-scope" | "rate-limited" | "unavailable" | undefined;
          botPresence?:
            | {
                state:
                  | "busy"
                  | "offline"
                  | "online"
                  | "unknown"
                  | "waiting-approval";
                source: "local" | "peer" | "task";
                checkedAt: number;
                expiresAt: number;
              }
            | undefined;
          canAssign?: boolean | undefined;
          verifiedAt?: number | undefined;
          verificationPendingUntil?: number | undefined;
          owner?: boolean | undefined;
        }[];
        complete: boolean;
        error?:
          | "missing-scope"
          | "partial"
          | "rate-limited"
          | "unavailable"
          | undefined;
      }
    | undefined;
  readonly status: Status;
  readonly t: import("../../../shared/i18n/ui-text").UiTranslate;
  readonly presenceNow: number;
  readonly locale:
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
  readonly locked: boolean;
  readonly refreshingMembers: boolean;
  readonly setRefreshingMembers: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly refresh: () => Promise<void>;
  readonly setError: import("react").Dispatch<
    import("react").SetStateAction<string>
  >;
  readonly current:
    | {
        key: string;
        targets: {
          conversation: {
            connectionId: string;
            id: string;
            kind: "direct" | "group";
            spaceId?: string | undefined;
            spaceRevision?: string | undefined;
          };
          name?: string | undefined;
          platform?: "feishu" | "lark" | "slack" | "wecom" | undefined;
          nameError?: string | undefined;
          lastSeenAt: number;
          identities: {
            channel: "feishu" | "slack" | "wecom";
            connectionId: string;
            tenantId: string;
            appId: string;
            userId: string;
          }[];
          saved: import("@artemis/protocol").CollaborationSpace | undefined;
          owner:
            | {
                channel: "feishu" | "slack" | "wecom";
                connectionId: string;
                tenantId: string;
                appId: string;
                userId: string;
              }
            | undefined;
          displayName: string;
          label: string;
          value: string;
        }[];
      }
    | undefined;
}
export function createGroupMemberRenderer(
  context: CreateGroupMemberRendererContext,
) {
  const {
    rosterFor,
    status,
    t,
    presenceNow,
    locale,
    locked,
    refreshingMembers,
    setRefreshingMembers,
    refresh,
    setError,
    current,
  } = context;
  function memberList(target: GroupChoice, targets: GroupChoice[]) {
    const roster = rosterFor(target);
    const members = roster?.members ?? [];
    const refreshTargets = targets.filter(
      (group) =>
        group.saved?.nativeGroup?.ownerDeviceId === status.settings.deviceId,
    );
    return (
      <details className="im-group-members" key={current?.key}>
        <summary>
          <UsersThree size={16} aria-hidden="true" />
          {t("GroupAuthorization.members")}
          {members.length > 0 && <span>{members.length}</span>}
          <CaretRight
            className="im-group-members-caret"
            size={14}
            aria-hidden="true"
          />
        </summary>
        {members.length > 0 ? (
          <ul>
            {members.map((member) => {
              const presence =
                member.kind === "bot"
                  ? "online"
                  : imGroupMemberStatus(
                      member,
                      status,
                      target.saved?.id,
                      Math.max(presenceNow, Date.now()),
                    );
              return (
                <li key={imIdentityKey(member.identity)}>
                  <span className="im-group-member-name">
                    <span
                      className="im-group-member-avatar"
                      data-state={presence}
                      role="img"
                      aria-label={t(
                        member.kind === "bot"
                          ? "ImGroupMembers.message14"
                          : member.kind === "human"
                            ? "ImGroupMembers.message13"
                            : "ImGroupMembers.message12",
                      )}
                    >
                      {member.kind === "bot" ? (
                        <ArtemisIcon name="bot" width={18} height={18} />
                      ) : (
                        <User size={18} weight="fill" aria-hidden="true" />
                      )}
                    </span>
                    <span>
                      {member.name?.trim() &&
                      !Object.values(member.identity).includes(
                        member.name.trim(),
                      )
                        ? member.name
                        : t("GroupAuthorization.nameUnavailable")}
                    </span>
                  </span>
                  <span
                    className="im-group-member-status"
                    title={
                      member.kind === "bot"
                        ? t("ImGroupMembers.message9")
                        : imMemberTooltip(member, presence, locale)
                    }
                    data-state={presence}
                  >
                    <span className="im-group-member-dot" aria-hidden="true" />
                    {member.kind === "bot"
                      ? t("ImGroupMembers.message9")
                      : imMemberLabel(presence, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t("GroupAuthorization.membersUnavailable")}</p>
        )}
        {roster && !roster.complete && members.length > 0 && (
          <p>{t("GroupAuthorization.membersPartial")}</p>
        )}
        {refreshTargets.length > 0 && status.localGateway && (
          <Button
            size="compact"
            variant="quiet"
            disabled={locked || refreshingMembers}
            icon={<ArrowClockwise aria-hidden="true" />}
            onClick={async () => {
              setRefreshingMembers(true);
              try {
                await Promise.all(
                  refreshTargets.map((group) =>
                    window.artemis.manageIm({
                      action: "refresh-group-members",
                      spaceId: group.saved!.id,
                    }),
                  ),
                );
                await refresh();
              } catch (error) {
                setError(String(error));
              } finally {
                setRefreshingMembers(false);
              }
            }}
          >
            {t("GroupAuthorization.refresh")}
          </Button>
        )}
      </details>
    );
  }
  return { memberList };
}
