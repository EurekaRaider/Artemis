import { imProjectPolicy } from "@artemis/protocol";

import { Checkbox } from "@artemis/ui/forms";

import { type AuthorizationDraft } from "../im-authorization-draft";

interface CreateGroupAuthorizationSummaryContext {
  readonly draft: AuthorizationDraft | undefined;
  readonly command:
    | {
        version: 1;
        operationId: string;
        supersedes?: string | undefined;
        intent: "create" | "edit" | "pause" | "rebind" | "renew" | "restore";
        deviceId: string;
        gatewayUrl: string;
        conversation: {
          connectionId: string;
          id: string;
          kind: "direct" | "group";
          spaceId?: string | undefined;
          spaceRevision?: string | undefined;
        };
        owner: {
          channel: "feishu" | "slack" | "wecom";
          connectionId: string;
          tenantId: string;
          appId: string;
          userId: string;
        };
        name: string;
        projectId: string;
        expectedPolicyVersion: string | null;
        expectedGroupVersion: string | null;
        expectedScopeVersion: string | null;
        expectedDeviceEnabled: boolean;
        expectedImpactVersion: string;
        policy?:
          | {
              approval: "ask" | "automatic";
              mode: "codemode" | "plan" | "work";
              network: boolean;
              shell: boolean;
              expiresAt: number;
            }
          | undefined;
        scope: {
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
        };
        fullAccessConfirmed?: boolean | undefined;
        enableService: boolean;
        confirmationFingerprint: string;
      }
    | undefined;
  readonly fullLocal: boolean;
  readonly t: import("../../../shared/i18n/ui-text").UiTranslate;
  readonly locked: boolean;
  readonly conflict: boolean;
  readonly validCommand: boolean;
  readonly setDraft: import("react").Dispatch<
    import("react").SetStateAction<AuthorizationDraft | undefined>
  >;
  readonly groups: {
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
}
export function createGroupAuthorizationSummary(
  context: CreateGroupAuthorizationSummaryContext,
) {
  const {
    draft,
    command,
    fullLocal,
    t,
    locked,
    conflict,
    validCommand,
    setDraft,
    groups,
    locale,
  } = context;
  const confirmationControl = draft && command && (
    <Checkbox
      label={t(
        fullLocal && draft.intent !== "pause"
          ? "GroupAuthorization.confirmFullLocal"
          : "GroupAuthorization.confirmSharing",
      )}
      checked={draft.confirmation === command.confirmationFingerprint}
      disabled={locked || conflict || !validCommand}
      onCheckedChange={(checked) =>
        setDraft({
          ...draft,
          confirmation: checked ? command.confirmationFingerprint : "",
          dirty: true,
        })
      }
    />
  );
  const policyChanged =
    !!draft?.editPolicy &&
    JSON.stringify(imProjectPolicy(draft.grant)) !==
      JSON.stringify(
        draft.baseline.grants.find((g) => g.projectId === draft.projectId) &&
          imProjectPolicy(
            draft.baseline.grants.find((g) => g.projectId === draft.projectId)!,
          ),
      );
  const affected = draft
    ? groups.filter((g) => g.saved?.nativeGroup?.projectId === draft.projectId)
    : [];
  const expiration = (value: number) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "full",
      timeStyle: "long",
    }).format(value);
  return { confirmationControl, policyChanged, affected, expiration };
}
