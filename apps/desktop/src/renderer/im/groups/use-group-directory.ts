import { type Status, type GroupChoice } from "./group-values.js";

import {
  imConversationKey,
  imIdentityKey,
  imGroupRosterSchema,
  imAuthorizationCommandSchema,
  type ImAuthorizationOperation,
  type ImConnectionStatus,
} from "@artemis/protocol";

import {
  imNativeGroupChoices,
  imNativeGroupDirectory,
} from "../ImNativeGroups";

import {
  authorizationDraftConflict,
  draftAuthorizationCommand,
  type AuthorizationDraft,
  type AuthorizationTarget,
} from "../im-authorization-draft";

interface UseGroupDirectoryContext {
  readonly diagnostics: unknown;
  readonly status: Status;
  readonly t: import("../../../shared/i18n/ui-text").UiTranslate;
  readonly view: "group" | "project";
  readonly projectFilter: string;
  readonly query: string;
  readonly selected: string;
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
  readonly draft: AuthorizationDraft | undefined;
  readonly operation: ImAuthorizationOperation | undefined;
  readonly submitting: boolean;
}
export function useGroupDirectory(context: UseGroupDirectoryContext) {
  const {
    diagnostics,
    status,
    t,
    view,
    projectFilter,
    query,
    selected,
    draft,
    operation,
    submitting,
  } = context;
  const groups = imNativeGroupChoices(
    diagnostics,
    status.spaces ?? [],
    status.settings.deviceId,
    t,
  );
  const directory = imNativeGroupDirectory(groups)
    .map((entry) => ({
      ...entry,
      targets: entry.targets.filter(
        (group) =>
          view === "group" ||
          !projectFilter ||
          group.saved?.nativeGroup?.projectId === projectFilter,
      ),
    }))
    .filter((entry) => entry.targets.length > 0);
  const visibleGroups = directory.filter((entry) =>
    entry.targets.some((group) =>
      group.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ),
  );
  const key = (group: AuthorizationTarget) =>
    imConversationKey(group.conversation);
  const current = directory.find(
    (entry) =>
      entry.key === selected ||
      entry.targets.some((group) => key(group) === selected),
  );
  const currentGroup = current?.targets[0];
  const currentPlatform =
    currentGroup?.platform ?? currentGroup?.identities[0]?.channel;
  const memberTargets = current?.targets
    .map((target) => ({ target, roster: context.rosterFor(target) }))
    .sort(
      (a, b) =>
        Number(!!b.roster?.complete) - Number(!!a.roster?.complete) ||
        (b.roster?.members.length ?? 0) - (a.roster?.members.length ?? 0),
    );
  const memberTarget = memberTargets?.[0];
  const command = draft && draftAuthorizationCommand(draft);
  const validCommand =
    !!command &&
    imAuthorizationCommandSchema.safeParse(command).success &&
    (draft?.intent === "pause" || (draft?.grant.expiresAt ?? 0) > Date.now());
  const currentDraftTarget =
    draft?.target && groups.find((g) => key(g) === key(draft.target!));
  const identityTarget = currentDraftTarget ?? draft?.target;
  const identityRoster = imGroupRosterSchema.safeParse(
    (identityTarget?.saved as { roster?: unknown } | undefined)?.roster,
  );
  const ownerIdentity = command?.owner;
  const ownerKey = ownerIdentity && imIdentityKey(ownerIdentity);
  const ownerPerson = identityRoster.success
    ? identityRoster.data.members.find(
        (member) => imIdentityKey(member.identity) === ownerKey,
      )
    : undefined;
  const ownerParticipant = identityTarget?.saved?.participants.find(
    (member) => imIdentityKey(member.identity) === ownerKey,
  );
  const identityConnection = (
    status.connections as ImConnectionStatus[] | undefined
  )?.find(
    (item) =>
      item.id === ownerIdentity?.connectionId &&
      item.channel === ownerIdentity.channel,
  );
  const identityBot = identityRoster.success
    ? identityRoster.data.members.find(
        (member) =>
          member.self &&
          member.kind === "bot" &&
          member.identity.connectionId === ownerIdentity?.connectionId &&
          member.identity.channel === ownerIdentity.channel &&
          member.identity.tenantId === ownerIdentity.tenantId &&
          member.identity.appId === ownerIdentity.appId,
      )
    : undefined;
  const displayIdentityName = (...names: (string | undefined)[]) =>
    names
      .find(
        (name) =>
          name?.trim() &&
          ![
            ...Object.values(ownerIdentity ?? {}),
            ...Object.values(identityBot?.identity ?? {}),
            status.settings.deviceId,
          ].includes(name.trim()),
      )
      ?.trim() ?? t("GroupAuthorization.nameUnavailable");
  const conflict =
    !!draft &&
    authorizationDraftConflict(draft, status.settings, currentDraftTarget);
  const pending =
    operation ??
    status.authorizationOperations?.find(
      (op) => op.state !== "complete" && op.state !== "superseded",
    );
  const locked =
    submitting ||
    (!!pending &&
      pending.state !== "complete" &&
      draft?.supersedes !== pending.command.operationId);
  const active = draft?.grant;
  const localScope = active?.security?.scopes[0];
  const fullLocal = localScope?.localAccess === "full";
  return {
    groups,
    directory,
    visibleGroups,
    key,
    current,
    currentGroup,
    currentPlatform,
    memberTarget,
    command,
    validCommand,
    currentDraftTarget,
    identityTarget,
    ownerPerson,
    ownerParticipant,
    identityConnection,
    identityBot,
    displayIdentityName,
    conflict,
    pending,
    locked,
    active,
    localScope,
    fullLocal,
  };
}
